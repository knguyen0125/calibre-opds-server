import * as FS from "node:fs";
import * as Path from "node:path";
import type { DeviceTag } from "../auth.ts";
import type { OptimizeProgress } from "../optimizer/optimize.ts";
import { OPTIMIZER_VERSION, optimizeEpub } from "../optimizer/optimize.ts";

/**
 * Disk cache for optimized EPUBs. Optimization is expensive (tens of
 * seconds for image-heavy books on pure-JS decoders) and the X4 may
 * give up on a slow first download; caching means the retry — and every
 * later download — is served instantly.
 *
 * Keys combine book id, device, the source file's size+mtime (so calibre
 * edits invalidate), and the optimizer version. Writes are atomic
 * (tmp + rename); a size-capped, oldest-first sweep keeps the directory
 * under OPTIMIZER_CACHE_MAX_BYTES (default 2 GiB).
 */
const inFlight = new Map<string, Promise<Uint8Array>>();

const cacheDir = (): string =>
  process.env.OPTIMIZER_CACHE_DIR || "optimizer-cache";

const cacheMaxBytes = (): number =>
  Number(process.env.OPTIMIZER_CACHE_MAX_BYTES) || 2 * 1024 ** 3;

async function cacheKey(
  bookId: number,
  device: DeviceTag,
  sourcePath: string,
): Promise<string> {
  const stat = await FS.promises.stat(sourcePath);
  const hasher = new Bun.CryptoHasher("sha1");
  hasher.update(
    `${OPTIMIZER_VERSION}:${bookId}:${device}:${stat.size}:${Math.floor(stat.mtimeMs)}`,
  );
  return `${bookId}-${device}-${hasher.digest("hex").slice(0, 12)}`;
}

async function evictOldestUntilUnderCap(): Promise<void> {
  const max = cacheMaxBytes();
  const dir = cacheDir();
  const names = await FS.promises.readdir(dir).catch(() => [] as string[]);
  const files: { path: string; size: number; mtime: number }[] = [];
  let total = 0;
  for (const name of names) {
    const path = Path.join(dir, name);
    const stat = await FS.promises.stat(path).catch(() => null);
    if (!stat?.isFile()) continue;
    files.push({ path, size: stat.size, mtime: stat.mtimeMs });
    total += stat.size;
  }
  files.sort((a, b) => a.mtime - b.mtime);
  for (const file of files) {
    if (total <= max) break;
    await FS.promises.unlink(file.path).catch(() => {});
    total -= file.size;
    console.log(
      `[optimize] cache evicted ${Path.basename(file.path)} (${file.size}b)`,
    );
  }
}

async function writeCache(file: string, data: Uint8Array): Promise<void> {
  try {
    await FS.promises.mkdir(Path.dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    await FS.promises.writeFile(tmp, data);
    await FS.promises.rename(tmp, file);
    await evictOldestUntilUnderCap();
  } catch (error) {
    console.error("[optimize] cache write failed:", error);
  }
}

export async function getOptimizedEpub(
  bookId: number,
  device: DeviceTag,
  sourcePath: string,
): Promise<Uint8Array> {
  const key = await cacheKey(bookId, device, sourcePath);
  const file = Path.join(cacheDir(), `${key}.epub`);

  try {
    const cached = new Uint8Array(await Bun.file(file).arrayBuffer());
    console.log(`[optimize] book=${bookId} device=${device} cache hit ${key}`);
    return cached;
  } catch {
    /* cache miss */
  }

  const existing = inFlight.get(key);
  if (existing) {
    console.log(
      `[optimize] book=${bookId} device=${device} joining in-flight job ${key}`,
    );
    return existing;
  }

  const startedAt = Date.now();
  let lastProgressLog = 0;
  const onProgress = (progress: OptimizeProgress) => {
    // At most one progress line per phase every 2s; completion is
    // reported by the summary log.
    const now = Date.now();
    if (now - lastProgressLog < 2000) return;
    lastProgressLog = now;
    console.log(
      `[optimize] book=${bookId} device=${device} ${progress.phase} ` +
        `${progress.done}/${progress.total} +${now - startedAt}ms`,
    );
  };

  const run = (async () => {
    const input = new Uint8Array(await Bun.file(sourcePath).arrayBuffer());
    const { data, stats } = await optimizeEpub(input, device, onProgress);
    console.log(
      `[optimize] book=${bookId} device=${device} ` +
        `${stats.originalBytes} -> ${stats.optimizedBytes} bytes ` +
        `images=${stats.images}(err ${stats.imageErrors}) ` +
        `fixes=${stats.fixes} splits=${stats.splitSections}/${stats.splitParts} ` +
        `pxc=${stats.pxcEntries} in ${stats.elapsedMs}ms`,
    );
    await writeCache(file, data);
    return data;
  })();

  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}
