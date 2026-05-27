import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const scriptsDir = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export const projectRoot = path.dirname(scriptsDir);
export const packageJson = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));

function envWithStringsOnly(source) {
  return Object.fromEntries(
    Object.entries(source).filter(([, value]) => typeof value === "string")
  );
}

function readArg(args, index, flag) {
  const value = args[index + 1];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

function usage() {
  return [
    "Usage: npm run smoke:list-tools -- [--published | --package <pkg> | --server-command <command>]",
    "       npm run smoke:review-unapproved -- [--published | --package <pkg> | --server-command <command>]",
    "",
    "Defaults to the local checkout entrypoint: node index.js",
    "Use --published to test npx -y @oliverames/ynab-mcp-server@latest from /tmp.",
  ].join("\n");
}

export function parseSmokeOptions(args = process.argv.slice(2)) {
  const options = {
    mode: "local",
    packageSpec: `${packageJson.name}@latest`,
    serverCommand: null,
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage());
      process.exit(0);
    }
    if (arg === "--published") {
      options.mode = "published";
      continue;
    }
    if (arg === "--package") {
      options.mode = "published";
      options.packageSpec = readArg(args, i, arg);
      i += 1;
      continue;
    }
    if (arg === "--server-command") {
      options.mode = "custom";
      options.serverCommand = readArg(args, i, arg);
      i += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}\n\n${usage()}`);
  }

  return options;
}

export function serverParamsForOptions(options) {
  if (options.mode === "published") {
    return {
      label: `npx -y ${options.packageSpec}`,
      command: "npx",
      args: ["-y", options.packageSpec],
      cwd: "/tmp",
    };
  }

  if (options.mode === "custom") {
    return {
      label: options.serverCommand,
      command: "bash",
      args: ["-lc", options.serverCommand],
      cwd: projectRoot,
    };
  }

  return {
    label: "node index.js",
    command: "node",
    args: ["index.js"],
    cwd: projectRoot,
  };
}

export async function withSmokeClient(options, callback) {
  const params = serverParamsForOptions(options);
  const transport = new StdioClientTransport({
    command: params.command,
    args: params.args,
    cwd: params.cwd,
    env: envWithStringsOnly(process.env),
    stderr: "pipe",
  });

  const stderrChunks = [];
  transport.stderr?.on("data", (chunk) => stderrChunks.push(chunk.toString()));

  const client = new Client({ name: "ynab-mcp-smoke", version: packageJson.version });
  try {
    await client.connect(transport);
    return await callback(client, params);
  } catch (error) {
    const stderr = stderrChunks.join("").trim();
    if (stderr) {
      console.error("\nServer stderr:");
      console.error(stderr);
    }
    throw error;
  } finally {
    await client.close().catch(() => {});
  }
}

export function parseTextToolResult(result) {
  const textItem = result.content?.find((item) => item.type === "text" && item.text);
  if (!textItem) {
    throw new Error("Tool result did not include text content");
  }
  return JSON.parse(textItem.text);
}
