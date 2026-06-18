#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const packageJson = readJson("package.json");
const version = packageJson.version;
const packageName = packageJson.name;

const pluginName = "ynab-mcp-server";
const marketplaceName = "ynab-mcp-server";
const packageInstallTarget = `${packageName}@latest`;

updateJson(".claude-plugin/plugin.json", (data) => {
  data.version = version;
});

updateJson(".codex-plugin/plugin.json", (data) => {
  data.version = version;
});

updateJson(".claude-plugin/marketplace.json", (data) => {
  for (const plugin of data.plugins ?? []) {
    if (plugin.name === pluginName) {
      plugin.version = version;
    }
  }
});

updateJson(".agents/plugins/marketplace.json", (data) => {
  for (const plugin of data.plugins ?? []) {
    if (plugin.name === pluginName) {
      plugin.version = version;
    }
  }
});

updateJson(".mcp.json", (data) => {
  setPackageInstallTarget(data.mcpServers?.[pluginName]);
});

updateJson(".codex-plugin/mcp.json", (data) => {
  setPackageInstallTarget(data.mcpServers?.[pluginName]);
});

function setPackageInstallTarget(server) {
  if (!server || !Array.isArray(server.args)) {
    return;
  }
  const packageIndex = server.args.findIndex(
    (arg) => typeof arg === "string" && /^@oliverames\/.+@latest$/.test(arg)
  );
  if (packageIndex >= 0) {
    server.args[packageIndex] = packageInstallTarget;
  }
}

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function updateJson(relativePath, update) {
  const fullPath = path.join(projectRoot, relativePath);
  const data = readJson(relativePath);
  update(data);
  fs.writeFileSync(fullPath, `${JSON.stringify(data, null, 2)}\n`);
}

console.log(`Synced ${marketplaceName} plugin metadata to ${version}`);
