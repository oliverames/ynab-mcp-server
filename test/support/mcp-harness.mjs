import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { FakeYnabHttpServer } from "./fake-ynab.mjs";

// Never load developer config, autostart stdio, or resolve real credentials in this harness.
process.env.YNAB_MCP_NO_AUTOSTART = "1";
process.env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK = "1";
process.env.YNAB_API_TOKEN = "fake-unused-bootstrap-token";
process.env.YNAB_RATE_LIMIT_PER_HOUR = "0";
process.env.YNAB_HTTP_RETRIES = "1";
delete process.env.YNAB_API_TOKEN_FILE;
delete process.env.YNAB_OP_PATH;
delete process.env.YNAB_BUDGET_ID;

const { createYnabServer, createFsJournal } = await import("../../index.js");

export function toolData(result) {
  if (result.structuredContent?.result !== undefined) return result.structuredContent.result;
  const text = result.content?.filter((item) => item.type === "text").map((item) => item.text).join("\n") ?? "";
  try { return JSON.parse(text); } catch { return text; }
}

export function assertToolOk(result) {
  assert.equal(result.isError ?? false, false, typeof toolData(result) === "string" ? toolData(result) : JSON.stringify(toolData(result)));
  return toolData(result);
}

export async function createMcpHarness({ fake, token = "fake-token-a", sessionId = "fake-session-a", writesEnabled = true, journalPath, previewTtlMs, cacheTtlMs, now } = {}) {
  const ownsFake = !fake;
  fake ??= await new FakeYnabHttpServer().start();
  const directory = journalPath ? null : await mkdtemp(join(tmpdir(), "ynab-synthetic-integration-"));
  journalPath ??= join(directory, "journal.json");
  const journal = createFsJournal(journalPath);
  const instance = createYnabServer({
    getAccessToken: async () => token,
    hasCredentials: true,
    defaultBudgetId: fake.budget(token).id,
    writesEnabled,
    sessionId,
    tenantId: fake.tenants.get(token).id,
    ...(previewTtlMs === undefined ? {} : { previewTtlMs }),
    ...(cacheTtlMs === undefined ? {} : { cacheTtlMs }),
    ...(now === undefined ? {} : { now }),
    fetchImpl: fake.fetch,
    journal,
    runtime: { tokenSource: "synthetic-test", sessionId },
  });
  const client = new Client({ name: "synthetic-agent-evaluation", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([instance.server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    client, fake, journal, journalPath, instance,
    call: (name, args = {}) => client.callTool({ name, arguments: args }),
    async preview(name, args = {}) {
      const result = await client.callTool({ name: "preview_write_tool", arguments: { tool_name: name, input: args } });
      const data = assertToolOk(result);
      const previewToken = data.preview_token ?? data.previewToken ?? data.token;
      assert.equal(typeof previewToken, "string", JSON.stringify(data));
      return { data, previewToken };
    },
    async write(name, args = {}) {
      const { previewToken } = await this.preview(name, args);
      // Explicit approval in these fixtures is synthetic, supplied by the fixture user.
      return this.call(name, { ...args, previewToken, confirmed: true });
    },
    async close() {
      await Promise.allSettled([client.close(), instance.server.close()]);
      if (ownsFake) await fake.close();
      if (directory) await rm(directory, { recursive: true, force: true });
    },
  };
}
