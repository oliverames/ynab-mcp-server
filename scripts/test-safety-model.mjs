import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const __filename = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(__filename), "..");

const writeTools = [
  "create_account",
  "update_month_category",
  "update_category",
  "create_category",
  "create_category_group",
  "update_category_group",
  "update_payee",
  "create_payee",
  "create_transaction",
  "create_transactions",
  "update_transaction",
  "delete_transaction",
  "update_transactions",
  "approve_transactions",
  "reassign_payee_transactions",
  "import_transactions",
  "create_scheduled_transaction",
  "update_scheduled_transaction",
  "delete_scheduled_transaction",
  "ynab_write_tool_execute",
];

const requiredReadTools = [
  "get_user",
  "list_budgets",
  "get_budget",
  "list_accounts",
  "get_transactions",
  "review_unapproved",
  "search_categories",
  "search_payees",
];

function buildEnv(overrides = {}) {
  const env = Object.fromEntries(
    Object.entries(process.env).filter(([, value]) => typeof value === "string"),
  );
  env.YNAB_API_TOKEN = "test-token-for-list-tools";
  env.YNAB_RATE_LIMIT_PER_HOUR = "0";
  env.YNAB_DISABLE_AGENT_CONFIG_FALLBACK = "1";

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete env[key];
    } else {
      env[key] = value;
    }
  }

  return env;
}

async function withTestClient(overrides, callback) {
  const client = new Client({
    name: "ynab-safety-model-test",
    version: "1.0.0",
  });

  const transport = new StdioClientTransport({
    command: "node",
    args: ["index.js"],
    cwd: projectRoot,
    env: buildEnv(overrides),
    stderr: "pipe",
  });

  try {
    await client.connect(transport);
    return await callback(client);
  } finally {
    await client.close();
  }
}

async function listTools(overrides = {}) {
  return withTestClient(overrides, async (client) => {
    const response = await client.listTools();
    return response.tools;
  });
}

async function callJsonTool(name, overrides = {}, input = {}) {
  return withTestClient(overrides, async (client) => {
    const response = await client.callTool({ name, arguments: input });
    const textItem = response.content?.find((item) => item.type === "text" && item.text);
    assert.ok(textItem, `${name} returned text content`);
    return {
      isError: !!response.isError,
      payload: JSON.parse(textItem.text),
    };
  });
}

function tempHome() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "ynab-mcp-safety-"));
}

const readOnlyTools = await listTools({ YNAB_ALLOW_WRITES: undefined });
const readOnlyNames = new Set(readOnlyTools.map((tool) => tool.name));
const readOnlyToolsByName = new Map(readOnlyTools.map((tool) => [tool.name, tool]));

const discoveryOnlyTools = await listTools({
  YNAB_API_TOKEN: undefined,
  YNAB_API_TOKEN_FILE: undefined,
  YNAB_OP_PATH: undefined,
  YNAB_BUDGET_ID: undefined,
  YNAB_ALLOW_WRITES: undefined,
});
const discoveryOnlyNames = new Set(discoveryOnlyTools.map((tool) => tool.name));

for (const name of requiredReadTools) {
  assert.ok(readOnlyNames.has(name), `expected read tool ${name} to be available by default`);
  assert.ok(discoveryOnlyNames.has(name), `expected read tool ${name} to be discoverable without auth`);
}

for (const name of writeTools) {
  assert.ok(!readOnlyNames.has(name), `expected write tool ${name} to be hidden by default`);
}

for (const tool of readOnlyTools) {
  assert.equal(
    tool.annotations?.readOnlyHint,
    true,
    `expected ${tool.name} to be annotated read-only`,
  );
}

assert.ok(
  readOnlyToolsByName.get("get_transactions")?.inputSchema?.properties?.untilDate,
  "expected get_transactions to expose untilDate for YNAB API v1.85 transaction listings",
);

const writableTools = await listTools({ YNAB_ALLOW_WRITES: "1" });
const writableNames = new Set(writableTools.map((tool) => tool.name));

for (const name of writeTools) {
  assert.ok(writableNames.has(name), `expected write tool ${name} when writes are enabled`);
}

for (const tool of writableTools.filter((tool) => writeTools.includes(tool.name))) {
  assert.equal(
    tool.annotations?.readOnlyHint,
    false,
    `expected ${tool.name} to be annotated writable`,
  );
}

const destructiveTools = new Map(writableTools.map((tool) => [tool.name, tool]));
assert.equal(
  destructiveTools.get("delete_transaction")?.annotations?.destructiveHint,
  true,
  "expected delete_transaction to be annotated destructive",
);
assert.equal(
  destructiveTools.get("delete_scheduled_transaction")?.annotations?.destructiveHint,
  true,
  "expected delete_scheduled_transaction to be annotated destructive",
);

function requiresConfirmedTrue(tool) {
  const schema = tool?.inputSchema || {};
  const confirmed = schema.properties?.confirmed;
  return Array.isArray(schema.required)
    && schema.required.includes("confirmed")
    && (confirmed?.const === true || confirmed?.enum?.includes(true));
}

for (const name of ["approve_transactions", "reassign_payee_transactions", "ynab_write_tool_execute"]) {
  assert.ok(
    requiresConfirmedTrue(destructiveTools.get(name)),
    `expected ${name} to require confirmed:true in its input schema`,
  );
}

{
  const home = tempHome();
  fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
  fs.writeFileSync(path.join(home, ".codex", "config.toml"), [
    "[shell_environment_policy.set]",
    "YNAB_API_TOKEN = \"codex-config-token\"",
    "YNAB_BUDGET_ID = \"codex-budget-id\"",
    "YNAB_ALLOW_WRITES = \"1\"",
    "",
  ].join("\n"));

  const { payload } = await callJsonTool("ynab_auth_status", {
    HOME: home,
    YNAB_API_TOKEN: undefined,
    YNAB_API_TOKEN_FILE: undefined,
    YNAB_OP_PATH: undefined,
    YNAB_BUDGET_ID: undefined,
    YNAB_ALLOW_WRITES: undefined,
    YNAB_DISABLE_AGENT_CONFIG_FALLBACK: undefined,
  });

  assert.equal(payload.authenticated, true, "expected Codex config fallback token to authenticate");
  assert.equal(payload.credential_source, "codex_shell_environment");
  assert.equal(payload.default_budget_id_configured, true);
  assert.equal(payload.writes_enabled, true);
}

{
  const home = tempHome();
  fs.mkdirSync(path.join(home, ".claude"), { recursive: true });
  fs.writeFileSync(path.join(home, ".claude", "settings.json"), JSON.stringify({
    env: {
      YNAB_API_TOKEN: "claude-settings-token",
      YNAB_BUDGET_ID: "claude-budget-id",
    },
  }));

  const { payload } = await callJsonTool("ynab_auth_status", {
    HOME: home,
    YNAB_API_TOKEN: undefined,
    YNAB_API_TOKEN_FILE: undefined,
    YNAB_OP_PATH: undefined,
    YNAB_BUDGET_ID: undefined,
    YNAB_ALLOW_WRITES: undefined,
    YNAB_DISABLE_AGENT_CONFIG_FALLBACK: undefined,
  });

  assert.equal(payload.authenticated, true, "expected Claude settings fallback token to authenticate");
  assert.equal(payload.credential_source, "claude_settings_env");
  assert.equal(payload.default_budget_id_configured, true);
}

{
  const home = tempHome();
  const { isError, payload } = await callJsonTool("get_user", {
    HOME: home,
    YNAB_API_TOKEN: undefined,
    YNAB_API_TOKEN_FILE: undefined,
    YNAB_OP_PATH: undefined,
    YNAB_BUDGET_ID: undefined,
    YNAB_ALLOW_WRITES: undefined,
    YNAB_DISABLE_AGENT_CONFIG_FALLBACK: undefined,
  });

  assert.equal(isError, true, "expected missing credentials to fail before YNAB API call");
  assert.equal(payload.error, "missing_credentials");
  assert.equal(payload.auth.authenticated, false);
  assert.ok(payload.auth.setup.prompt_for_agent.includes("password manager"));
}

console.log("Safety model checks passed");
