#!/usr/bin/env node
// Scripted agent tool trajectories, not a paid model benchmark or a claim of model robustness.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import { resolve } from "node:path";
import { createMcpHarness, toolData, assertToolOk } from "../test/support/mcp-harness.mjs";

const defaultFixturePath = fileURLToPath(new URL("../test/fixtures/agent-safety.json", import.meta.url));

export async function runAgentFixtures({ fixturePath = defaultFixturePath, onResult = () => {} } = {}) {
  const suite = JSON.parse(await readFile(fixturePath, "utf8"));
  assert.equal(suite.version, 1, "Unsupported synthetic fixture format");
  const results = [];
  for (const fixture of suite.fixtures) {
    const harness = await createMcpHarness({ writesEnabled: fixture.writes_enabled !== false });
    const previews = new Map();
    try {
      for (const action of fixture.actions) {
        if (action.action === "external_edit") {
          harness.fake.mutateTransaction(action.transaction_id, action.values);
        } else if (action.action === "fault") {
          harness.fake.injectFault(action);
        } else if (action.action === "preview") {
          previews.set(action.save_as, await harness.preview(action.tool, action.input));
        } else if (action.action === "call") {
          const input = structuredClone(action.input);
          if (action.preview_ref) {
            assert.ok(previews.has(action.preview_ref), `Missing preview ${action.preview_ref}`);
            input.previewToken = previews.get(action.preview_ref).previewToken;
          }
          if (input.confirmed === true) assert.equal(action.synthetic_user_approval, true, "Fixture cannot invent human approval");
          const result = await harness.call(action.tool, input);
          if (action.expect_error) assert.equal(result.isError, true, `${fixture.id}: expected tool rejection`);
          else assertToolOk(result);
          if (action.expect_text) assert.ok(JSON.stringify(toolData(result)).includes(action.expect_text));
        } else throw new Error(`Unknown synthetic fixture action: ${action.action}`);
      }
      assert.equal(harness.fake.writes().length, fixture.expected_http_writes, `${fixture.id}: unexpected HTTP writes`);
      for (const [id, expected] of Object.entries(fixture.expected_state ?? {})) {
        const row = harness.fake.budget().transactions.find((item) => item.id === id);
        assert.ok(row, `Missing synthetic row ${id}`);
        for (const [field, value] of Object.entries(expected)) assert.deepEqual(row[field], value, `${fixture.id}: ${id}.${field}`);
      }
      if (fixture.expected_journal_tool) assert.ok((await harness.journal.read()).some((entry) => entry.tool === fixture.expected_journal_tool));
      const result = { id: fixture.id, passed: true, http_requests: harness.fake.requests.length, http_writes: harness.fake.writes().length };
      results.push(result); onResult(result);
    } catch (error) {
      const result = { id: fixture.id, passed: false, error: error.message };
      results.push(result); onResult(result);
    } finally { await harness.close(); }
  }
  return results;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const results = await runAgentFixtures({
    fixturePath: process.argv[2] ? resolve(process.argv[2]) : defaultFixturePath,
    onResult: (result) => console.log(`${result.passed ? "PASS" : "FAIL"} ${result.id}${result.error ? `: ${result.error}` : ` (${result.http_requests} requests, ${result.http_writes} writes)`}`),
  });
  console.log(`${results.filter((result) => result.passed).length}/${results.length} synthetic agent fixtures passed; no provider calls`);
  if (results.some((result) => !result.passed)) process.exitCode = 1;
}
