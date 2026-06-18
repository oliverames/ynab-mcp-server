#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const checkRegistry = process.argv.includes("--registry");

function readJson(relativePath) {
  return JSON.parse(fs.readFileSync(path.join(projectRoot, relativePath), "utf8"));
}

function readText(relativePath) {
  return fs.readFileSync(path.join(projectRoot, relativePath), "utf8");
}

const errors = [];
const checks = [];

function pass(message) {
  checks.push(message);
}

function assert(condition, message) {
  if (condition) {
    pass(message);
  } else {
    errors.push(message);
  }
}

const pkg = readJson("package.json");
const lock = readJson("package-lock.json");
const indexJs = readText("index.js");
const readme = readText("README.md");
const version = pkg.version;
const pluginName = "ynab-mcp-server";
const marketplaceName = "ynab-mcp-server";
const packageInstallTarget = `${pkg.name}@latest`;

assert(lock.version === version, `package-lock root version matches ${version}`);
assert(lock.packages?.[""]?.version === version, `package-lock package version matches ${version}`);
assert(indexJs.includes(`version: "${version}"`), `index.js McpServer version matches ${version}`);

const registeredToolNames = [...indexJs.matchAll(/^\s*registerTool\(\s*\n\s*"([^"]+)"/gm)]
  .map((match) => match[1]);
const registeredToolCount = registeredToolNames
  .filter((name) => !name.startsWith("ynab_"))
  .length;
const discoveryHelpers = ["ynab_auth_status", "ynab_tool_index", "ynab_tool_execute", "ynab_write_tool_execute"];
for (const helperName of discoveryHelpers) {
  assert(registeredToolNames.includes(helperName), `discovery helper ${helperName} is registered`);
}
const readmeToolCounts = [...new Set(
  [...readme.matchAll(/\b(\d+) tools\b/gi)].map((match) => Number(match[1]))
)];
assert(
  readmeToolCounts.length > 0 && readmeToolCounts.every((count) => count === registeredToolCount),
  readmeToolCounts.length > 0
    ? `README tool count references match ${registeredToolCount}`
    : "README includes at least one tool count reference"
);

const releaseVersions = [
  ...readme.matchAll(/github\.com\/oliverames\/ynab-mcp-server\/releases\/(?:tag|download)\/v(\d+\.\d+\.\d+)/g),
].map((match) => match[1]);
const staleReleaseVersions = [...new Set(releaseVersions.filter((releaseVersion) => releaseVersion !== version))];
assert(
  staleReleaseVersions.length === 0,
  staleReleaseVersions.length === 0
    ? `README release links match v${version}`
    : `README has stale release link versions: ${staleReleaseVersions.join(", ")}`
);

const mcpbVersions = [...readme.matchAll(/(?:ynab-mcp-server|mcp-server-for-ynab)-(\d+\.\d+\.\d+)\.mcpb/g)].map((match) => match[1]);
const staleMcpbVersions = [...new Set(mcpbVersions.filter((mcpbVersion) => mcpbVersion !== version))];
assert(
  staleMcpbVersions.length === 0,
  staleMcpbVersions.length === 0
    ? (mcpbVersions.length > 0 ? `README MCPB artifact references match ${version}` : "README has no MCPB artifact references")
    : `README has stale MCPB artifact versions: ${staleMcpbVersions.join(", ")}`
);

const claudePlugin = readJson(".claude-plugin/plugin.json");
const codexPlugin = readJson(".codex-plugin/plugin.json");
const claudeMarketplace = readJson(".claude-plugin/marketplace.json");
const codexMarketplace = readJson(".agents/plugins/marketplace.json");
const claudeMcp = readJson(".mcp.json");
const codexMcp = readJson(".codex-plugin/mcp.json");
const claudeMarketplacePlugin = claudeMarketplace.plugins?.find((plugin) => plugin.name === pluginName);
const codexMarketplacePlugin = codexMarketplace.plugins?.find((plugin) => plugin.name === pluginName);
const claudeMcpServer = claudeMcp.mcpServers?.[pluginName];
const codexMcpServer = codexMcp.mcpServers?.[pluginName];

assert(claudePlugin.version === version, `Claude plugin manifest version matches ${version}`);
assert(codexPlugin.version === version, `Codex plugin manifest version matches ${version}`);
assert(claudeMarketplace.name === marketplaceName, `Claude marketplace name is ${marketplaceName}`);
assert(codexMarketplace.name === marketplaceName, `Codex marketplace name is ${marketplaceName}`);
assert(claudeMarketplacePlugin?.version === version, `Claude marketplace plugin version matches ${version}`);
assert(codexMarketplacePlugin?.version === version, `Codex marketplace plugin version matches ${version}`);
assert(claudePlugin.mcpServers === "./.mcp.json", "Claude plugin mcpServers points to ./.mcp.json");
assert(codexPlugin.mcpServers === "./.codex-plugin/mcp.json", "Codex plugin mcpServers points to ./.codex-plugin/mcp.json");
assert(claudeMcpServer?.args?.includes(packageInstallTarget), `Claude MCP config launches ${packageInstallTarget}`);
assert(codexMcpServer?.args?.includes(packageInstallTarget), `Codex MCP config launches ${packageInstallTarget}`);

if (checkRegistry) {
  const npmVersion = execFileSync("npm", ["view", pkg.name, "version"], {
    cwd: projectRoot,
    encoding: "utf8",
  }).trim();
  assert(npmVersion === version, `npm latest matches ${version}`);
}

if (errors.length > 0) {
  for (const message of errors) {
    console.error(`FAIL: ${message}`);
  }
  process.exit(1);
}

for (const message of checks) {
  console.log(`PASS: ${message}`);
}
