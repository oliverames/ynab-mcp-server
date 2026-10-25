import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { OP_TOKEN_CACHE_TTL_MS, readCachedOpToken, writeCachedOpToken } from "../lib/op-token-cache.mjs";

const posix = process.platform !== "win32";
const REFERENCE = "op://Fake/Synthetic item/credential";
const TOKEN = "synthetic-op-cache-token-1234567890";

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "ynab-op-cache-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const cache = join(root, "cache");
  return { root, cache, directory: join(cache, "ynab-mcp-server"), env: { XDG_CACHE_HOME: cache }, home: join(root, "home") };
}

const cacheFile = (directory, reference = REFERENCE) => join(directory, `${createHash("sha256").update(reference).digest("hex")}.json`);

test("the cache reads back a written token inside the TTL and expires it after", { skip: !posix }, (t) => {
  const { directory, env, home } = sandbox(t);
  let clock = 1_000_000;
  const options = { env, home, now: () => clock };
  assert.equal(readCachedOpToken(REFERENCE, options), null);
  assert.equal(writeCachedOpToken(REFERENCE, TOKEN, options), true);
  assert.equal(readCachedOpToken(REFERENCE, options), TOKEN);
  assert.equal(readCachedOpToken("op://Fake/Other/credential", options), null, "another reference is a different key");
  clock += OP_TOKEN_CACHE_TTL_MS - 1;
  assert.equal(readCachedOpToken(REFERENCE, options), TOKEN);
  clock += 1;
  assert.equal(readCachedOpToken(REFERENCE, options), null);
  assert.equal(existsSync(cacheFile(directory)), false, "a stale file is removed");
});

test("the cache file is mode 600 in a mode 700 directory, keyed by a hash that hides the reference", { skip: !posix }, (t) => {
  const { directory, env, home } = sandbox(t);
  writeCachedOpToken(REFERENCE, TOKEN, { env, home });
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(cacheFile(directory)).mode & 0o777, 0o600);
  assert.deepEqual(readdirSync(directory), [`${createHash("sha256").update(REFERENCE).digest("hex")}.json`]);
});

test("the cache defaults to ~/.cache and ignores a relative XDG_CACHE_HOME", { skip: !posix }, (t) => {
  const { root, home } = sandbox(t);
  assert.equal(writeCachedOpToken(REFERENCE, TOKEN, { env: { XDG_CACHE_HOME: "relative/cache" }, home }), true);
  assert.equal(existsSync(cacheFile(join(home, ".cache", "ynab-mcp-server"))), true);
  assert.equal(existsSync(join(root, "relative")), false);
});

test("loose permissions, foreign owners, symlinks and corrupt files all read as a miss", { skip: !posix }, (t) => {
  const { directory, env, home } = sandbox(t);
  const options = { env, home };
  writeCachedOpToken(REFERENCE, TOKEN, options);
  const file = cacheFile(directory);
  chmodSync(file, 0o644);
  assert.equal(readCachedOpToken(REFERENCE, options), null, "group/world-readable file");
  chmodSync(file, 0o600);
  assert.equal(readCachedOpToken(REFERENCE, options), TOKEN);
  chmodSync(directory, 0o755);
  assert.equal(readCachedOpToken(REFERENCE, options), null, "group/world-accessible directory");
  assert.equal(writeCachedOpToken(REFERENCE, "replacement-token", options), false, "no write into a loose directory");
  chmodSync(directory, 0o700);
  assert.equal(readCachedOpToken(REFERENCE, { ...options, uid: process.getuid() + 1 }), null, "file owned by someone else");
  rmSync(file);
  writeFileSync(join(directory, "target"), JSON.stringify({ version: 1, fetchedAt: Date.now(), token: TOKEN }), { mode: 0o600 });
  symlinkSync(join(directory, "target"), file);
  assert.equal(readCachedOpToken(REFERENCE, options), null, "symlink");
  rmSync(file);
  writeFileSync(file, "{not json", { mode: 0o600 });
  assert.equal(readCachedOpToken(REFERENCE, options), null, "corrupt file");
  writeFileSync(file, JSON.stringify({ version: 1, fetchedAt: Date.now() + 60_000, token: TOKEN }), { mode: 0o600 });
  assert.equal(readCachedOpToken(REFERENCE, options), null, "a timestamp from the future");
});

test("YNAB_OP_CACHE=0 and Windows disable reads and writes", (t) => {
  const { directory, env, home } = sandbox(t);
  for (const value of ["0", "false", "OFF"]) {
    assert.equal(writeCachedOpToken(REFERENCE, TOKEN, { env: { ...env, YNAB_OP_CACHE: value }, home }), false);
  }
  assert.equal(writeCachedOpToken(REFERENCE, TOKEN, { env, home, platform: "win32" }), false);
  assert.equal(existsSync(directory), false);
  if (posix) {
    writeCachedOpToken(REFERENCE, TOKEN, { env, home });
    assert.equal(readCachedOpToken(REFERENCE, { env: { ...env, YNAB_OP_CACHE: "0" }, home }), null);
    assert.equal(readCachedOpToken(REFERENCE, { env, home, platform: "win32" }), null);
  }
});

// The server resolves YNAB_OP_PATH at startup, so exercise real processes with a fake `op`.
function fakeOp(root, { token = TOKEN } = {}) {
  const bin = join(root, "bin");
  mkdirSync(bin, { recursive: true });
  const log = join(root, "op-calls.log");
  writeFileSync(join(bin, "op"), `#!/bin/sh\necho "$@" >> '${log}'\nprintf '%s\\n' '${token}'\n`, { mode: 0o755 });
  return { bin, calls: () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").length : 0) };
}

async function authStatus({ bin, home, cache, extra = {} }) {
  const env = {
    PATH: `${bin}:${process.env.PATH}`, HOME: home, XDG_CACHE_HOME: cache,
    YNAB_DISABLE_AGENT_CONFIG_FALLBACK: "1", YNAB_OP_PATH: REFERENCE, ...extra,
  };
  const client = new Client({ name: "op-cache-test", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath, args: ["index.js"], cwd: new URL("..", import.meta.url).pathname, env, stderr: "pipe" });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "ynab_auth_status", arguments: {} });
    const text = result.content.find((item) => item.type === "text").text;
    return { text, data: JSON.parse(text) };
  } finally {
    await client.close();
  }
}

test("separate server processes share one `op read` and never print the token", { skip: !posix }, async (t) => {
  const { root, cache, home, directory } = sandbox(t);
  const op = fakeOp(root);
  const options = { bin: op.bin, home, cache };
  const first = await authStatus(options);
  assert.equal(first.data.credential_source, "onepassword_cli");
  assert.equal(first.data.credential_source_label, "YNAB_OP_PATH via 1Password CLI");
  const second = await authStatus(options);
  assert.equal(second.data.credential_source, "onepassword_cli");
  assert.match(second.data.credential_source_label, /short-lived local cache/);
  assert.equal(op.calls(), 1, "the second process used the cache");
  assert.doesNotMatch(first.text + second.text, new RegExp(TOKEN));
  // Staleness is judged from the file, so aging it forces a fresh read.
  const file = cacheFile(directory);
  writeFileSync(file, JSON.stringify({ version: 1, fetchedAt: Date.now() - OP_TOKEN_CACHE_TTL_MS - 1000, token: "stale-token" }), { mode: 0o600 });
  const third = await authStatus(options);
  assert.equal(third.data.credential_source_label, "YNAB_OP_PATH via 1Password CLI");
  assert.equal(op.calls(), 2);
  assert.equal(JSON.parse(readFileSync(file, "utf8")).token, TOKEN, "the refreshed token replaced the stale one");
});

test("YNAB_OP_CACHE=0 keeps every process on `op read` and writes nothing", { skip: !posix }, async (t) => {
  const { root, cache, home, directory } = sandbox(t);
  const op = fakeOp(root);
  const options = { bin: op.bin, home, cache, extra: { YNAB_OP_CACHE: "0" } };
  await authStatus(options);
  await authStatus(options);
  assert.equal(op.calls(), 2);
  assert.equal(existsSync(directory), false);
});
