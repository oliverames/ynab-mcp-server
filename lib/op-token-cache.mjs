import { createHash, randomBytes } from "node:crypto";
import {
  closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import path from "node:path";

// A short-lived, cross-process cache for a token that `op read` resolved.
// MCP hosts start one server process per session, so without it every
// concurrent session pays its own 1Password authorization. The token is in
// process memory after `op read` either way; this keeps a mode-600 copy in a
// mode-700 directory for a few minutes. The cache is best effort: anything
// unexpected (missing, stale, loose permissions, wrong owner, symlink,
// corrupt) reads as a miss, and write failures are ignored. The token is never
// logged or included in an error.
export const OP_TOKEN_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_CACHE_FILE_BYTES = 4096;
const DISABLED_VALUES = new Set(["0", "false", "off", "no"]);

export function opTokenCacheDisabled(env = process.env) {
  return DISABLED_VALUES.has(String(env.YNAB_OP_CACHE ?? "").trim().toLowerCase());
}

function cacheLocation(reference, { env, home }) {
  const xdg = env.XDG_CACHE_HOME;
  const base = typeof xdg === "string" && path.isAbsolute(xdg) ? xdg : path.join(home, ".cache");
  const directory = path.join(base, "ynab-mcp-server");
  const name = createHash("sha256").update(reference).digest("hex");
  return { directory, file: path.join(directory, `${name}.json`) };
}

// POSIX mode bits and ownership are what make the cache safe, so it is off on
// platforms that cannot check them (Windows).
function supported({ env, platform, uid }) {
  return platform !== "win32" && typeof uid === "number" && !opTokenCacheDisabled(env);
}

function privateEnough(stats, uid, mask) {
  return stats.uid === uid && (stats.mode & mask) === 0;
}

function defaults(options) {
  return {
    env: options.env ?? process.env,
    home: options.home,
    platform: options.platform ?? process.platform,
    uid: "uid" in options ? options.uid : process.getuid?.(),
    now: options.now ?? Date.now,
  };
}

export function readCachedOpToken(reference, options = {}) {
  const ctx = defaults(options);
  if (!supported(ctx)) return null;
  const { directory, file } = cacheLocation(reference, ctx);
  try {
    const dir = lstatSync(directory);
    if (!dir.isDirectory() || !privateEnough(dir, ctx.uid, 0o077)) return null;
    const stats = lstatSync(file);
    if (!stats.isFile() || stats.size > MAX_CACHE_FILE_BYTES || !privateEnough(stats, ctx.uid, 0o077)) return null;
    const record = JSON.parse(readFileSync(file, "utf8"));
    const age = ctx.now() - record.fetchedAt;
    if (record.version !== 1 || typeof record.token !== "string" || !record.token || !Number.isFinite(age)) return null;
    if (age < 0 || age >= OP_TOKEN_CACHE_TTL_MS) {
      try { unlinkSync(file); } catch { /* Another process may have replaced it. */ }
      return null;
    }
    return record.token;
  } catch {
    return null;
  }
}

export function writeCachedOpToken(reference, token, options = {}) {
  const ctx = defaults(options);
  if (!supported(ctx) || typeof token !== "string" || !token) return false;
  const { directory, file } = cacheLocation(reference, ctx);
  const temporary = `${file}.${process.pid}.${randomBytes(6).toString("hex")}.tmp`;
  try {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const dir = lstatSync(directory);
    if (!dir.isDirectory() || !privateEnough(dir, ctx.uid, 0o077)) return false;
    const fd = openSync(temporary, "wx", 0o600);
    try {
      writeFileSync(fd, JSON.stringify({ version: 1, fetchedAt: ctx.now(), token }));
      fsyncSync(fd);
    } finally {
      closeSync(fd);
    }
    renameSync(temporary, file);
    return true;
  } catch {
    try { unlinkSync(temporary); } catch { /* Nothing was created. */ }
    return false;
  }
}
