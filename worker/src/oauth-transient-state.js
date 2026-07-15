import { DurableObject } from "cloudflare:workers";

const RECORD_KEY = "record";

export class OAuthTransientState extends DurableObject {
  async fetch(request) {
    const url = new URL(request.url);

    if (request.method === "PUT" && url.pathname === "/record") {
      const record = await request.json();
      if (!record || !Number.isFinite(record.expiresAt) || record.expiresAt <= Date.now()) {
        return new Response("Invalid transient state", { status: 400 });
      }
      await this.ctx.storage.put(RECORD_KEY, record);
      try {
        await this.ctx.storage.setAlarm(record.expiresAt);
      } catch (error) {
        await this.ctx.storage.deleteAll();
        throw error;
      }
      return new Response(null, { status: 204 });
    }

    if (request.method === "POST" && url.pathname === "/consume") {
      const record = await this.ctx.storage.transaction(async (txn) => {
        const current = await txn.get(RECORD_KEY);
        if (current) await txn.delete(RECORD_KEY);
        return current;
      });
      if (!record) return new Response(null, { status: 404 });
      await this.ctx.storage.deleteAlarm();
      if (record.expiresAt <= Date.now()) return new Response(null, { status: 410 });
      return Response.json(record.value);
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
