import * as FS from "node:fs";
import * as Path from "node:path";
import { SQL } from "bun";

const RELOAD_DEBOUNCE_MS = 3_000;
const RELOAD_INTERVAL_MS = 60 * 60 * 1_000;
const WATCH_RETRY_MS = 10_000;

let dbUrl = "";
let dbFile = "";
let dbDir = "";
let loadedIno: number | undefined;

/**
 * SQLite connection shared by all catalog queries.
 *
 * Bun.SQL pools connections per instance and never reopens the underlying
 * file. Sync tools like Resilio replace metadata.db via rename, which gives
 * the file a new inode; the pooled connection keeps reading the old,
 * unlinked one. reloadDb() swaps in a fresh instance to pick up the change.
 */
export let db: SQL;

export function initDb(path: string) {
  dbUrl = `file://${path}`;
  dbFile = Path.basename(path);
  dbDir = Path.dirname(path);
  db = new SQL(dbUrl);
}

export async function reloadDb() {
  const previous = db;
  db = new SQL(dbUrl);
  loadedIno = currentIno();
  await previous.close();
}

function currentIno(): number | undefined {
  try {
    return FS.statSync(Path.join(dbDir, dbFile)).ino;
  } catch {
    return undefined;
  }
}

/**
 * Watch the library directory and reload the connection when the database
 * file is replaced. Same-inode rewrites are already visible to SQLite, so
 * only inode changes trigger a reload. An hourly check backs up the watch
 * in case events are missed entirely.
 */
export function watchLibrary() {
  loadedIno = currentIno();
  let reloadTimer: Timer | undefined;

  const scheduleReload = () => {
    clearTimeout(reloadTimer);
    reloadTimer = setTimeout(runReload, RELOAD_DEBOUNCE_MS);
  };

  const runReload = async () => {
    const ino = currentIno();
    if (ino === undefined || ino === loadedIno) return;

    try {
      await reloadDb();
      console.log(`[db] ${dbFile} replaced; reloaded database connection`);
    } catch (error) {
      console.error(`[db] failed to reload ${dbFile}:`, error);
    }
  };

  const startWatching = () => {
    const watcher = FS.watch(dbDir, { recursive: false }, (_event, file) => {
      if (file?.startsWith(dbFile)) scheduleReload();
    });

    watcher.on("error", (error) => {
      console.error("[db] library watcher failed:", error);
      watcher.close();
      setTimeout(startWatching, WATCH_RETRY_MS);
    });
  };

  setInterval(runReload, RELOAD_INTERVAL_MS);
  startWatching();
}
