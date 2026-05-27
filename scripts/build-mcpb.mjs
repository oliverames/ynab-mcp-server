#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(fs.readFileSync(path.join(projectRoot, "package.json"), "utf8"));
const force = process.argv.includes("--force");
const distDir = path.join(projectRoot, "dist");
const outputPath = path.join(distDir, `ynab-mcp-server-${pkg.version}.mcpb`);

if (fs.existsSync(outputPath) && !force) {
  console.error(`Refusing to overwrite existing artifact: ${outputPath}`);
  console.error("Pass --force to rebuild this generated artifact.");
  process.exit(1);
}

const stagingDir = fs.mkdtempSync(path.join(os.tmpdir(), "ynab-mcpb-"));

function copyFile(relativePath) {
  const source = path.join(projectRoot, relativePath);
  const destination = path.join(stagingDir, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.copyFileSync(source, destination);
}

function writeJson(relativePath, value) {
  const destination = path.join(stagingDir, relativePath);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, `${JSON.stringify(value, null, 2)}\n`);
}

const bundlePackage = {
  name: pkg.name,
  version: pkg.version,
  description: pkg.description,
  type: pkg.type,
  main: pkg.main,
  dependencies: pkg.dependencies,
  engines: pkg.engines,
};

writeJson("package.json", bundlePackage);
copyFile("package-lock.json");
copyFile("index.js");
copyFile("README.md");
copyFile("LICENSE");
copyFile("assets/icon.png");

writeJson("manifest.json", {
  manifest_version: "0.3",
  name: "ynab-mcp-server",
  display_name: "YNAB MCP Server",
  version: pkg.version,
  description: "Complete MCP server for YNAB budget operations.",
  author: {
    name: "Oliver Ames",
    url: "https://github.com/oliverames",
  },
  repository: {
    type: "git",
    url: "https://github.com/oliverames/ynab-mcp-server.git",
  },
  homepage: "https://github.com/oliverames/ynab-mcp-server#readme",
  documentation: "https://github.com/oliverames/ynab-mcp-server#readme",
  support: "https://github.com/oliverames/ynab-mcp-server/issues",
  icon: "assets/icon.png",
  server: {
    type: "node",
    entry_point: "index.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/index.js"],
      env: {
        YNAB_API_TOKEN: "${user_config.ynab_api_token}",
        YNAB_BUDGET_ID: "${user_config.ynab_budget_id}",
      },
    },
  },
  tools_generated: true,
  keywords: ["mcp", "model-context-protocol", "ynab", "budgeting", "personal-finance"],
  license: "MIT",
  privacy_policies: ["https://www.ynab.com/privacy-policy"],
  compatibility: {
    platforms: ["darwin", "win32", "linux"],
    runtimes: {
      node: ">=18.0.0",
    },
  },
  user_config: {
    ynab_api_token: {
      type: "string",
      title: "YNAB API Token",
      description: "Personal access token from YNAB Developer Settings.",
      required: true,
      sensitive: true,
    },
    ynab_budget_id: {
      type: "string",
      title: "Default Budget ID",
      description: "Optional default budget ID. Leave blank to use YNAB's last-used budget.",
      required: false,
    },
  },
});

execFileSync("npm", ["ci", "--omit=dev", "--no-audit", "--no-fund"], {
  cwd: stagingDir,
  stdio: "inherit",
});

fs.mkdirSync(distDir, { recursive: true });
if (force) {
  fs.rmSync(outputPath, { force: true });
}
execFileSync("zip", ["-qr", outputPath, "."], {
  cwd: stagingDir,
  stdio: "inherit",
});

const size = fs.statSync(outputPath).size;
console.log(`Built ${outputPath} (${size} bytes)`);
