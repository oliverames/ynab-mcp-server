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
  staleMcpbVersions.length === 0 && mcpbVersions.length > 0,
  staleMcpbVersions.length === 0
    ? `README MCPB artifact references match ${version}`
    : `README has stale MCPB artifact versions: ${staleMcpbVersions.join(", ")}`
);

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
