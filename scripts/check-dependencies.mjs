#!/usr/bin/env node

// Validation must not install packages or depend on shell-specific redirection.
for (const specifier of ["@modelcontextprotocol/sdk/client/index.js", "ynab", "zod"]) {
  try {
    await import(specifier);
  } catch {
    console.error(`Cannot load ${specifier}. Run npm ci explicitly before running checks.`);
    process.exitCode = 1;
    break;
  }
}
