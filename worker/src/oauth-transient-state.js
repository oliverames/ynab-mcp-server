import { DurableObject } from "cloudflare:workers";
import { consumeTransientRecord } from "./transient-state.js";

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
      let binding;
      try {
        binding = await request.json();
      } catch {
        return new Response("Invalid transient origin binding", { status: 400 });
      }
      return consumeTransientRecord(this.ctx.storage, binding);
    }

    return new Response("Not found", { status: 404 });
  }

  async alarm() {
    await this.ctx.storage.deleteAll();
  }
}
