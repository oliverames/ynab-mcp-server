import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// 1Password storage for the hosted smoke check's consent grant. One API
// Credential item holds the refresh token (`credential`), the public OAuth
// `client_id` it belongs to, the MCP endpoint it was issued for, and the
// consent date. Secrets move over stdin as a JSON item template, never as
// command-line arguments, so they cannot show up in a process listing. The
// template is a mode 0600 file in a private temp directory that is removed
// as soon as op returns (op only reads stdin from a true pipe, which a Node
// child process does not provide).

export const DEFAULT_OP_VAULT = "Development";
export const DEFAULT_OP_ITEM = "YNAB MCP hosted smoke token";

const FIELD_LABELS = {
  refreshToken: "credential",
  clientId: "client_id",
  mcpUrl: "mcp_url",
  consentedAt: "consented_at",
};

export function runOp(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("op", args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("error", (error) => {
      reject(new Error(error.code === "ENOENT"
        ? "The 1Password CLI (op) is not installed or not on PATH"
        : `Could not run op: ${error.message}`));
    });
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(Object.assign(new Error(stderr.trim() || `op exited with code ${code}`), { exitCode: code, stderr }));
    });
    child.stdin.end();
  });
}

async function withTemplateFile(template, callback) {
  const directory = await mkdtemp(join(tmpdir(), "ynab-smoke-op-"));
  const file = join(directory, "item.json");
  try {
    await writeFile(file, JSON.stringify(template), { mode: 0o600 });
    return await callback(file);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function isNotFound(error) {
  return /isn't an item|no item|not found/i.test(error?.message ?? "");
}

function fieldValue(item, label) {
  return item.fields?.find((field) => field.label === label || field.id === label)?.value ?? null;
}

function setField(fields, label, value, type, extra = {}) {
  const existing = fields.find((field) => field.label === label || field.id === label);
  if (existing) {
    existing.value = value;
    return;
  }
  fields.push({ label, type, value, ...extra });
}

export function createOpTokenStore({ run = runOp, vault = DEFAULT_OP_VAULT, title = DEFAULT_OP_ITEM } = {}) {
  async function getItem() {
    try {
      return JSON.parse(await run(["item", "get", title, `--vault=${vault}`, "--format=json", "--reveal"]));
    } catch (error) {
      if (isNotFound(error)) return null;
      throw error;
    }
  }

  return {
    describe: () => `op://${vault}/${title}`,

    async read() {
      const item = await getItem();
      if (!item) return null;
      const refreshToken = fieldValue(item, FIELD_LABELS.refreshToken);
      const clientId = fieldValue(item, FIELD_LABELS.clientId);
      if (!refreshToken || !clientId) return null;
      return {
        refreshToken,
        clientId,
        mcpUrl: fieldValue(item, FIELD_LABELS.mcpUrl),
        consentedAt: fieldValue(item, FIELD_LABELS.consentedAt),
      };
    },

    // Creates the item on first use, otherwise edits it in place. Passing
    // `consentedAt` marks a fresh consent; a rotation write-back leaves it alone.
    async save({ refreshToken, clientId, mcpUrl, consentedAt }) {
      const item = await getItem();
      if (!item) {
        const fields = [];
        setField(fields, FIELD_LABELS.refreshToken, refreshToken, "CONCEALED", { id: "credential" });
        setField(fields, FIELD_LABELS.clientId, clientId, "STRING");
        setField(fields, FIELD_LABELS.mcpUrl, mcpUrl, "STRING");
        setField(fields, FIELD_LABELS.consentedAt, consentedAt, "STRING");
        const template = {
          title,
          category: "API_CREDENTIAL",
          tags: ["ynab-mcp-server", "smoke-check"],
          fields,
        };
        await withTemplateFile(template, (file) => run(["item", "create", `--vault=${vault}`, `--template=${file}`]));
        return "created";
      }
      item.fields ??= [];
      setField(item.fields, FIELD_LABELS.refreshToken, refreshToken, "CONCEALED", { id: "credential" });
      if (clientId !== undefined) setField(item.fields, FIELD_LABELS.clientId, clientId, "STRING");
      if (mcpUrl !== undefined) setField(item.fields, FIELD_LABELS.mcpUrl, mcpUrl, "STRING");
      if (consentedAt !== undefined) setField(item.fields, FIELD_LABELS.consentedAt, consentedAt, "STRING");
      await withTemplateFile(item, (file) => run(["item", "edit", item.id, `--vault=${vault}`, `--template=${file}`]));
      return "updated";
    },
  };
}
