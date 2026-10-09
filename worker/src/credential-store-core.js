// Testable implementation of the private credential Durable Object protocol.
// One object per YNAB user; one encrypted credential/journal per consent.
import {
  credentialBindingsMatch,
  decryptStoredJson,
  encryptStoredJson,
  isCredentialBinding,
  readTokenRecord,
  refreshStoredCredential,
  saveTokenRecord,
  tokenRecordKey,
  undoJournalKey,
} from "./ynab-oauth.js";

const JOURNAL_CHUNK_SIZE = 512 * 1024;
const MAX_JOURNAL_CHUNKS = 32;

function journalChunkCount(raw) {
  const header = JSON.parse(raw);
  if (header?.storageVersion !== 2) return 0;
  if (!Number.isInteger(header.chunks) || header.chunks < 1 || header.chunks > MAX_JOURNAL_CHUNKS) {
    throw new Error("Invalid journal storage manifest");
  }
  return header.chunks;
}

async function readStoredJournal(storage, key, raw) {
  const chunks = journalChunkCount(raw);
  if (!chunks) return raw;
  let ciphertext = "";
  for (let index = 0; index < chunks; index += 1) {
    const value = await storage.get(`${key}:chunk:${index}`);
    if (typeof value !== "string" || !value || value.length > JOURNAL_CHUNK_SIZE) throw new Error("Journal ciphertext chunk missing");
    ciphertext += value;
  }
  return ciphertext;
}

async function persistStoredJournal(storage, key, encrypted, previousRaw) {
  // SQLite Durable Object KV limits a key+value to 2 MB. An operation history
  // can exceed that while each individual operation is valid. Commit bounded
  // ciphertext chunks and their manifest together; never split plaintext.
  const chunks = Math.ceil(encrypted.length / JOURNAL_CHUNK_SIZE);
  if (chunks > MAX_JOURNAL_CHUNKS) throw new Error("Encrypted journal exceeds its 16 MiB storage bound");
  const previousChunks = previousRaw ? journalChunkCount(previousRaw) : 0;
  await storage.transaction(async (txn) => {
    for (let index = 0; index < chunks; index += 1) {
      await txn.put(`${key}:chunk:${index}`, encrypted.slice(index * JOURNAL_CHUNK_SIZE, (index + 1) * JOURNAL_CHUNK_SIZE));
    }
    for (let index = chunks; index < previousChunks; index += 1) await txn.delete(`${key}:chunk:${index}`);
    await txn.put(key, JSON.stringify({ storageVersion: 2, chunks }));
  });
}

export class CredentialStoreCore {
  constructor(storage, env) {
    this.storage = storage;
    this.env = env;
    this.queue = Promise.resolve();
  }

  fetch(request) {
    // DO requests can interleave at an outbound fetch. Keep the whole refresh
    // and durable update together, including failures and deletion.
    const pending = this.queue.then(() => this.handle(request));
    this.queue = pending.catch(() => {});
    return pending;
  }

  async handle(request) {
    try {
      if (request.method !== "POST") return new Response(null, { status: 405 });
      const path = new URL(request.url).pathname;
      const body = await request.json();
      if (typeof body.ynabUserId !== "string" || !body.ynabUserId) return new Response(null, { status: 400 });
      const owner = await this.storage.get("user_identity");
      if (owner && owner !== body.ynabUserId) return new Response(null, { status: 403 });
      const generation = (await this.storage.get("deletion_generation")) ?? 0;
      if (path === "/generation") return Response.json({ generation });
      if (path === "/delete-all") {
        // A non-financial tombstone invalidates final forms displayed before
        // deletion without retaining a token, journal, or user-profile record.
        // Wipe and marker advancement must commit together: a storage failure
        // cannot reset the generation and resurrect an older pending consent.
        await this.storage.transaction(async (txn) => {
          const keys = [...(await txn.list()).keys()];
          for (let start = 0; start < keys.length; start += 128) {
            await txn.delete(keys.slice(start, start + 128));
          }
          await txn.put("deletion_generation", generation + 1);
        });
        return new Response(null, { status: 204 });
      }
      const { binding } = body;
      if (!isCredentialBinding(binding) || binding.ynabUserId !== body.ynabUserId) {
        return new Response(null, { status: 400 });
      }
      if (path === "/create") {
        if (typeof body.tokens?.accessToken !== "string" || !body.tokens.accessToken || !Number.isFinite(body.tokens.expiresAt)) return new Response(null, { status: 400 });
        if (body.generation !== generation) return new Response(null, { status: 409 });
        // Do not allow any later consent to replace an existing credential.
        if (await this.storage.get(tokenRecordKey(binding))) return new Response(null, { status: 409 });
        await this.storage.put("user_identity", body.ynabUserId);
        await saveTokenRecord(this.storage, binding, body.tokens, this.env.DATA_ENCRYPTION_KEY);
        return new Response(null, { status: 204 });
      }
      const tokens = await readTokenRecord(this.storage, binding, this.env.DATA_ENCRYPTION_KEY);
      if (!tokens) return new Response(null, { status: 401 });
      if (path === "/exists") return new Response(null, { status: 204 });
      if (path === "/remove") {
        const journalKey = undoJournalKey(binding);
        const journalRaw = await this.storage.get(journalKey);
        const chunks = journalRaw ? journalChunkCount(journalRaw) : 0;
        await this.storage.transaction(async (txn) => {
          await txn.delete(tokenRecordKey(binding));
          await txn.delete(journalKey);
          for (let index = 0; index < chunks; index += 1) await txn.delete(`${journalKey}:chunk:${index}`);
        });
        return new Response(null, { status: 204 });
      }
      if (path === "/token") {
        const accessToken = await refreshStoredCredential(this.env, this.storage, binding);
        return accessToken ? Response.json({ accessToken }) : new Response(null, { status: 401 });
      }
      if (path === "/journal/read" || path === "/journal/persist") {
        const key = undoJournalKey(binding);
        const raw = await this.storage.get(key);
        let current = { revision: 0, entries: [] };
        if (raw) {
          const decoded = await decryptStoredJson(this.env.DATA_ENCRYPTION_KEY, key, await readStoredJournal(this.storage, key, raw));
          if (decoded.legacy || !credentialBindingsMatch(decoded.value?.binding, binding)) return new Response(null, { status: 401 });
          current = decoded.value;
        }
        if (path === "/journal/read") return Response.json({ revision: current.revision, entries: current.entries });
        if (!Array.isArray(body.entries) || !Number.isInteger(body.expectedRevision)) return new Response(null, { status: 400 });
        if (body.expectedRevision !== current.revision) return new Response(null, { status: 409 });
        const revision = current.revision + 1;
        await persistStoredJournal(this.storage, key, await encryptStoredJson(this.env.DATA_ENCRYPTION_KEY, key, {
          binding, revision, entries: body.entries,
        }), raw);
        return Response.json({ revision });
      }
      return new Response(null, { status: 404 });
    } catch {
      // Never expose decrypted tokens, upstream response bodies, or storage
      // internals through MCP errors or the internal protocol.
      return new Response("Credential storage unavailable", { status: 503 });
    }
  }
}
