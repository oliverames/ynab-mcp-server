import { spawn } from "node:child_process";
import { DEFAULT_HOSTED_URL } from "./hosted-oauth.mjs";
import { DEFAULT_OP_ITEM, DEFAULT_OP_VAULT, createOpTokenStore } from "./op-token-store.mjs";

function usage(command, extra = []) {
  return [
    `Usage: ${command} [--url <mcp-url>] [--vault <name>] [--item <title>]${extra.map((flag) => ` [${flag}]`).join("")}`,
    "",
    `Defaults: --url ${process.env.YNAB_HOSTED_URL || DEFAULT_HOSTED_URL}, --vault ${process.env.YNAB_SMOKE_OP_VAULT || DEFAULT_OP_VAULT}, --item "${process.env.YNAB_SMOKE_OP_ITEM || DEFAULT_OP_ITEM}"`,
  ].join("\n");
}

export function parseHostedArgs(args, command, { flags = [] } = {}) {
  const options = {
    url: process.env.YNAB_HOSTED_URL || DEFAULT_HOSTED_URL,
    vault: process.env.YNAB_SMOKE_OP_VAULT || DEFAULT_OP_VAULT,
    item: process.env.YNAB_SMOKE_OP_ITEM || DEFAULT_OP_ITEM,
  };
  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === "--help" || arg === "-h") {
      console.log(usage(command, flags));
      process.exit(0);
    }
    if (flags.includes(arg)) {
      options[arg.slice(2).replace(/-(.)/g, (_, c) => c.toUpperCase())] = true;
      continue;
    }
    const key = { "--url": "url", "--vault": "vault", "--item": "item" }[arg];
    const value = args[i + 1];
    if (!key || !value || value.startsWith("--")) {
      throw new Error(`Unknown or incomplete option: ${arg}\n\n${usage(command, flags)}`);
    }
    options[key] = value;
    i += 1;
  }
  options.url = new URL(options.url).href;
  return options;
}

export function storeForOptions(options) {
  return createOpTokenStore({ vault: options.vault, title: options.item });
}

export function openInBrowser(url) {
  const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  return new Promise((resolve) => {
    const child = spawn(opener, [url], { stdio: "ignore", detached: true });
    child.on("error", () => resolve(false));
    child.unref();
    resolve(true);
  });
}
