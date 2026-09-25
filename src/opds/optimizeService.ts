import type { DeviceTag } from "../auth.ts";
import { optimizeEpub } from "../optimizer/optimize.ts";

/**
 * Per-book in-flight optimization. Downloads are not cached; concurrent
 * requests for the same book and device share one optimization run, and
 * the map entry is dropped as soon as the run settles.
 */
const inFlight = new Map<string, Promise<Uint8Array>>();

export async function getOptimizedEpub(
  bookId: number,
  device: DeviceTag,
  sourcePath: string,
): Promise<Uint8Array> {
  const key = `${bookId}:${device}`;
  const existing = inFlight.get(key);
  if (existing) return existing;

  const run = (async () => {
    const input = new Uint8Array(await Bun.file(sourcePath).arrayBuffer());
    const { data, stats } = await optimizeEpub(input, device);
    console.log(
      `[optimize] book=${bookId} device=${device} ` +
        `${stats.originalBytes} -> ${stats.optimizedBytes} bytes ` +
        `images=${stats.images}(err ${stats.imageErrors}) ` +
        `fixes=${stats.fixes} splits=${stats.splitSections}/${stats.splitParts} ` +
        `pxc=${stats.pxcEntries} in ${stats.elapsedMs}ms`,
    );
    return data;
  })();

  inFlight.set(key, run);
  try {
    return await run;
  } finally {
    inFlight.delete(key);
  }
}
