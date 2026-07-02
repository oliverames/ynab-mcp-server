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

const pluginManifestPaths = [
  ".claude-plugin/plugin.json",
  "codex/.codex-plugin/plugin.json",
  ".hermes-plugin/plugin.json",
  ".antigravity-plugin/plugin.json",
];

const marketplacePaths = [
  ".claude-plugin/marketplace.json",
  ".agents/plugins/marketplace.json",
  ".hermes-plugin/marketplace.json",
  ".antigravity-plugin/marketplace.json",
];

const mcpConfigPaths = [
  ".mcp.json",
  "codex/.codex-plugin/mcp.json",
  ".hermes-plugin/mcp.json",
  ".antigravity-plugin/mcp_config.json",
];

for (const manifestPath of pluginManifestPaths) {
  updateJson(manifestPath, (data) => {
    data.version = version;
  });
}

for (const marketplacePath of marketplacePaths) {
  updateJson(marketplacePath, (data) => {
    for (const plugin of data.plugins ?? []) {
      if (plugin.name === pluginName) {
        plugin.version = version;
      }
    }
  });
}

for (const mcpConfigPath of mcpConfigPaths) {
  updateJson(mcpConfigPath, (data) => {
    setPackageInstallTarget(findMcpServer(data));
  });
}

function findMcpServer(data) {
  return data.mcpServers?.[pluginName] ?? data[pluginName];
}

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
