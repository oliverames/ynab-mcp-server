import assert from "node:assert/strict";
import test from "node:test";
import { createHash } from "node:crypto";
import { YnabHandler } from "../src/ynab-handler.js";
import { remoteServerInfo, REMOTE_SERVER_INFO } from "../src/brand-assets.js";

const OLD_ORIGIN = "https://ynab.amesvt.com";
const CANONICAL_ORIGIN = "https://connector.example";

test("both landing and public policy pages advertise the configured canonical origin", async () => {
  for (const requestOrigin of [OLD_ORIGIN, CANONICAL_ORIGIN]) {
    const env = {
      CONNECTOR_BASE_URL: requestOrigin,
      CONNECTOR_CANONICAL_URL: CANONICAL_ORIGIN,
      COOKIE_ENCRYPTION_KEY: "synthetic-branding-test-cookie-key",
    };
    for (const path of ["/", "/privacy", "/delete"]) {
      const response = await YnabHandler.request(`${requestOrigin}${path}`, {}, env);
      assert.equal(response.status, 200);
      const body = await response.text();
      assert.ok(body.includes(`<link rel="canonical" href="${CANONICAL_ORIGIN}${path}">`));
      assert.ok(body.includes(`<meta property="og:image" content="${CANONICAL_ORIGIN}/assets/icon.png">`));
      assert.ok(body.includes('href="/favicon.svg"'));
      assert.ok(body.includes('<link rel="icon" type="image/png" sizes="256x256" href="/favicon-256x256.png">'));
      assert.ok(body.includes('href="/apple-touch-icon.png"'));
      assert.ok(body.includes("We are not affiliated, associated"));
      assert.ok(!body.includes(OLD_ORIGIN));
      if (path === "/") assert.ok(body.includes(`${CANONICAL_ORIGIN}/mcp`));
      if (path === "/delete") assert.ok(body.includes('action="/delete"'));
    }
    const error = await YnabHandler.request(`${requestOrigin}/authorize`, {}, {
      ...env, OAUTH_PROVIDER: { async parseAuthRequest() { throw new Error("synthetic invalid request"); } },
    });
    assert.equal(error.status, 400);
    const errorBody = await error.text();
    assert.ok(errorBody.includes(`${CANONICAL_ORIGIN}/assets/icon.png`));
    assert.ok(!errorBody.includes(OLD_ORIGIN));
    assert.ok(!errorBody.includes('rel="canonical"'));
  }
});

test("MCP branding follows canonical configuration without mutating static fallback identity", () => {
  const info = remoteServerInfo(CANONICAL_ORIGIN);
  assert.equal(info.websiteUrl, CANONICAL_ORIGIN);
  assert.deepEqual(info.icons.map((icon) => icon.src), [
    `${CANONICAL_ORIGIN}/assets/ynab-tree-icon-v2.svg`,
    `${CANONICAL_ORIGIN}/assets/ynab-tree-icon-v2.png`,
    `${CANONICAL_ORIGIN}/assets/ynab-tree-icon-v1.png`,
  ]);
  assert.deepEqual(info.icons.map(({ mimeType, sizes }) => ({ mimeType, sizes })), [
    { mimeType: "image/svg+xml", sizes: ["any"] },
    { mimeType: "image/png", sizes: ["4096x4096"] },
    { mimeType: "image/png", sizes: ["256x256"] },
  ]);
  assert.ok(info.icons.every((icon) => new URL(icon.src).origin === CANONICAL_ORIGIN));
  assert.equal(new Set(info.icons.map((icon) => icon.src)).size, info.icons.length);
  assert.equal(info.description, REMOTE_SERVER_INFO.description);
  assert.equal(REMOTE_SERVER_INFO.websiteUrl, OLD_ORIGIN);
  assert.ok(REMOTE_SERVER_INFO.icons.every((icon) => icon.src.startsWith(OLD_ORIGIN)));
});

test("the homepage allows its exact copy script while policy pages remain script-free", async () => {
  const env = { CONNECTOR_BASE_URL: CANONICAL_ORIGIN, COOKIE_ENCRYPTION_KEY: "synthetic-branding-test-cookie-key" };
  const response = await YnabHandler.request(`${CANONICAL_ORIGIN}/`, {}, env);
  const body = await response.text();
  const scripts = [...body.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  assert.equal(scripts.length, 1);
  const hash = createHash("sha256").update(scripts[0][1]).digest("base64");
  const policy = response.headers.get("content-security-policy");
  assert.ok(policy.includes(`script-src 'sha256-${hash}'`));
  assert.ok(!policy.includes("script-src 'unsafe-inline'"));
  assert.ok(!policy.includes("script-src 'self'"));
  assert.ok(body.includes(`value="${CANONICAL_ORIGIN}/mcp" readonly`));
  assert.ok(body.includes('href="https://github.com/oliverames/ynab-mcp-server"'));
  for (const path of ["/privacy", "/delete"]) {
    const policyResponse = await YnabHandler.request(`${CANONICAL_ORIGIN}${path}`, {}, env);
    assert.ok(!policyResponse.headers.get("content-security-policy").includes("script-src"));
    assert.ok(!(await policyResponse.text()).includes("<script>"));
  }
});
