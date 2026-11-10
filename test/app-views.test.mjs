import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createMcpHarness, assertToolOk } from "./support/mcp-harness.mjs";
import { APP_VIEW_TOOLS, BUDGET_OVERVIEW_URI, TRANSACTION_REVIEW_URI, buildViewHtml } from "../lib/app-views.mjs";

const MIME = "text/html;profile=mcp-app";
const textOf = (result) => result.content.filter((c) => c.type === "text").map((c) => c.text).join("\n");

test("get_month and review_unapproved advertise their ui:// views, and nothing else does", async (t) => {
  const h = await createMcpHarness({ writesEnabled: true });
  t.after(() => h.close());
  const { tools } = await h.client.listTools();
  const withUi = tools.filter((tool) => tool._meta?.ui?.resourceUri || tool._meta?.["ui/resourceUri"]);
  assert.deepEqual(withUi.map((tool) => tool.name).sort(), ["get_month", "review_unapproved"]);
  for (const tool of withUi) {
    assert.equal(tool._meta.ui.resourceUri, APP_VIEW_TOOLS[tool.name]);
    assert.equal(tool._meta["ui/resourceUri"], APP_VIEW_TOOLS[tool.name]);
    assert.equal(tool.annotations.readOnlyHint, true, `${tool.name} must stay read-only`);
  }
  const { resources } = await h.client.listResources();
  for (const uri of [BUDGET_OVERVIEW_URI, TRANSACTION_REVIEW_URI]) {
    const resource = resources.find((r) => r.uri === uri);
    assert.equal(resource?.mimeType, MIME);
    const { contents } = await h.client.readResource({ uri });
    assert.equal(contents[0].mimeType, MIME);
    assert.match(contents[0].text, /^<!DOCTYPE html>/);
    assert.equal(contents[0]._meta?.ui?.csp, undefined, "views are self-contained and declare no CSP origins");
  }
});

test("the text result is identical with and without the views", async (t) => {
  const on = await createMcpHarness({ writesEnabled: false });
  const off = await createMcpHarness({ writesEnabled: false, appViews: false });
  t.after(() => Promise.all([on.close(), off.close()]));
  const { tools } = await off.client.listTools();
  assert.equal(tools.some((tool) => tool._meta?.ui), false);
  assert.equal((await off.client.listResources()).resources.some((r) => r.uri.startsWith("ui://")), false);
  for (const [name, args] of [["get_month", { month: "2026-10-01" }], ["review_unapproved", {}]]) {
    const a = await on.call(name, args), b = await off.call(name, args);
    assertToolOk(a);
    assert.equal(textOf(a), textOf(b), `${name} text fallback changed`);
    assert.deepEqual(a.structuredContent, b.structuredContent);
  }
});

test("view sources never build HTML from data, load remote code or call a write tool", () => {
  for (const uri of [BUDGET_OVERVIEW_URI, TRANSACTION_REVIEW_URI]) {
    const own = [uri === BUDGET_OVERVIEW_URI ? "budget-overview.html" : "transaction-review.html", "shared.js", "shared.css"]
      .map((f) => readFileSync(new URL(`../lib/app-views/${f}`, import.meta.url), "utf8")).join("\n");
    assert.doesNotMatch(own, /\b(innerHTML|outerHTML|insertAdjacentHTML|document\.write|srcdoc|eval\s*\(|new Function)\b/);
    assert.doesNotMatch(own, /(?:src|href)\s*=\s*["']https?:|@import|url\(\s*["']?https?:/);
    assert.doesNotMatch(own, /\bfetch\s*\(|XMLHttpRequest|WebSocket/);
    // The only tool a view may call itself is the read-only get_month (month navigation).
    const calls = [...own.matchAll(/callServerTool\(\{\s*name:\s*"([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(calls.filter((name) => name !== "get_month"), []);
    const html = buildViewHtml(uri);
    assert.doesNotMatch(html, /<script[^>]+src=|<link[^>]+href=/i);
  }
});

test("views ship no copied brand artwork: no logo, no embedded fonts or images", () => {
  for (const uri of [BUDGET_OVERVIEW_URI, TRANSACTION_REVIEW_URI]) {
    const html = buildViewHtml(uri);
    assert.doesNotMatch(html, /data:(?:font|image)\//);
    assert.doesNotMatch(html, /@font-face|<img\b|<image\b/i);
  }
});
