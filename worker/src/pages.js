// Static page bodies for the connector. Every page carries non-affiliation
// language per docs/hosted-oauth-connector.md and YNAB's naming guidance.

import { CONNECTOR_ORIGIN } from "./brand-assets.js";

const NON_AFFILIATION = "MCP Server for YNAB is an independent open-source project by Oliver Ames. We are not affiliated, associated, or in any way officially connected with YNAB or any of its subsidiaries or affiliates. The official YNAB website can be found at <a href=\"https://www.ynab.com\">www.ynab.com</a>. The names YNAB and You Need A Budget, as well as related names, tradenames, marks, trademarks, emblems, and images are registered trademarks of YNAB.";

export function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function layout(title, body, { origin = CONNECTOR_ORIGIN, canonicalPath } = {}) {
  const safeOrigin = escapeHtml(new URL(origin).origin);
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<link rel="icon" type="image/png" sizes="256x256" href="/favicon-256x256.png">
<link rel="icon" href="/favicon.svg" type="image/svg+xml">
<link rel="alternate icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="apple-touch-icon" sizes="180x180" href="/apple-touch-icon.png">
${canonicalPath ? `<link rel="canonical" href="${safeOrigin}${escapeHtml(canonicalPath)}">\n<meta property="og:url" content="${safeOrigin}${escapeHtml(canonicalPath)}">` : ""}
<meta property="og:image" content="${safeOrigin}/assets/icon.png">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1024">
<meta property="og:image:height" content="1024">
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 44rem; margin: 3rem auto; padding: 0 1rem 3rem; line-height: 1.55; color: #1c1c1c; }
  h1 { font-size: 1.5rem; } code { background: #f4f4f4; padding: .1em .35em; border-radius: 4px; }
  .card { border: 1px solid #ddd; border-radius: 12px; padding: 1.25rem 1.5rem; background: #fff; }
  .accent { color: #b8791f; } .muted { color: #555; font-size: .9rem; }
  button, .btn { background: #f5a542; border: none; border-radius: 8px; padding: .6rem 1.2rem; font-size: 1rem; cursor: pointer; }
  label { display: block; margin: .75rem 0; }
  .brand { display: block; width: 196px; height: 78px; margin-bottom: 1.5rem; }
  footer { margin-top: 2.5rem; font-size: .85rem; color: #666; border-top: 1px solid #eee; padding-top: 1rem; }
</style>
</head>
<body>
<img class="brand" src="/assets/works-with-ynab.svg" width="196" height="78" alt="Works with YNAB">
${body}
<footer>${NON_AFFILIATION}<br>Support: <a href="https://github.com/oliverames/ynab-mcp-server/issues">github.com/oliverames/ynab-mcp-server</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/delete">Delete my data</a></footer>
</body>
</html>`;
}

// This script only copies the public endpoint. The homepage permits its exact
// SHA-256 hash; consent and other public pages remain script-free.
export const LANDING_SCRIPT = `
const endpoint = document.getElementById("connector-endpoint");
const copyButton = document.getElementById("copy-endpoint");
const copyStatus = document.getElementById("copy-status");
copyButton.hidden = false;
copyButton.addEventListener("click", async () => {
  try {
    await navigator.clipboard.writeText(endpoint.value);
    copyStatus.textContent = "Endpoint copied.";
  } catch {
    endpoint.focus();
    endpoint.select();
    copyStatus.textContent = "Select and copy the endpoint above.";
  }
});
`;

export function landingPage({ origin = CONNECTOR_ORIGIN } = {}) {
  const safeEndpoint = escapeHtml(new URL("/mcp", origin).href);
  return layout("MCP Server for YNAB | Remote Connector", `
<style>
  .landing h1 { font-size: clamp(1.8rem, 5vw, 2.3rem); line-height: 1.2; letter-spacing: -.025em; margin: 0 0 .75rem; }
  .landing .intro { font-size: 1.1rem; color: #444; margin: 0 0 1.75rem; }
  .landing h2 { font-size: 1.2rem; margin: 0 0 .4rem; }
  .landing .card { padding: 1.4rem; border-color: #dcdce5; }
  .landing .transport { color: #62626f; font-size: .85rem; margin: 0 0 1rem; }
  .landing label { font-size: .9rem; font-weight: 600; margin: 0 0 .4rem; }
  .landing .endpoint-control { display: flex; gap: .5rem; }
  .landing input { box-sizing: border-box; min-width: 0; width: 100%; border: 1px solid #c7c7d2; border-radius: 8px; padding: .7rem; font: .9rem ui-monospace, SFMono-Regular, monospace; background: #f8f8fb; color: #242438; }
  .landing button { flex-shrink: 0; min-height: 44px; background: #514a86; color: #fff; font-weight: 600; padding: .6rem 1rem; }
  .landing :is(input, button, a):focus-visible { outline: 3px solid #847ab5; outline-offset: 3px; }
  .landing .copy-status { min-height: 1.4em; margin: .4rem 0 .8rem; color: #555; font-size: .85rem; }
  .landing ol { padding-left: 1.3rem; margin: 0; }
  .landing li { padding-left: .25rem; margin: .65rem 0; }
  .landing .oauth-note { color: #555; font-size: .9rem; margin: 1rem 0 0; }
  .landing .capabilities { margin-top: 1.8rem; }
  .landing .capabilities p { margin: .6rem 0; }
  .landing .examples { padding-left: 1.2rem; }
  .landing .project-link { display: inline-block; margin-top: .65rem; color: #463e78; font-weight: 600; }
  @media (max-width: 480px) {
    .landing .card { padding: 1rem; }
    .landing .endpoint-control { flex-direction: column; }
    .landing input { font-size: .85rem; }
    .landing button { width: 100%; }
  }
</style>
<main class="landing">
<h1>MCP Server for YNAB</h1>
<p class="intro">Connect your AI assistant to your YNAB budget. This remote <a href="https://modelcontextprotocol.io">MCP</a> connector lets it review spending, category balances and transactions using your own YNAB account.</p>
<section class="card" aria-labelledby="setup-heading">
<h2 id="setup-heading">Connect your assistant</h2>
<p class="transport">Remote MCP &middot; Streamable HTTP &middot; OAuth</p>
<label for="connector-endpoint">Connector endpoint</label>
<div class="endpoint-control">
  <input id="connector-endpoint" type="url" value="${safeEndpoint}" readonly spellcheck="false">
  <button id="copy-endpoint" type="button" hidden>Copy endpoint</button>
</div>
<p id="copy-status" class="copy-status" role="status"></p>
<ol>
  <li>Add a remote MCP connector in your assistant's settings, using the endpoint above and OAuth authentication.</li>
  <li>Choose your access. Read-only is the default; enable write access only if you want your assistant to make changes.</li>
  <li>Sign in with YNAB and finish the connector's confirmation. Then ask your assistant about your budget.</li>
</ol>
<p class="oauth-note">OAuth handles sign-in, so you don't need to enter a personal access token. Your assistant must support remote MCP connections with OAuth.</p>
</section>
<section class="capabilities" aria-labelledby="capabilities-heading">
<h2 id="capabilities-heading">Review your budget</h2>
<p>Ask about your spending or find transactions that need attention:</p>
<ul class="examples">
  <li>&ldquo;Which categories are overspent?&rdquo;</li>
  <li>&ldquo;Show me my unapproved transactions.&rdquo;</li>
</ul>
<p>If you enable writes, you can also categorize transactions and adjust category budgets. Every change requires an exact preview and your approval.</p>
<a class="project-link" href="https://github.com/oliverames/ynab-mcp-server">View source and setup on GitHub</a>
</section>
</main>
<script>${LANDING_SCRIPT}</script>`, { origin, canonicalPath: "/" });
}

export function consentPage({ clientName, redirectUri, consentId, csrfToken, origin = CONNECTOR_ORIGIN }) {
  const safeClientName = escapeHtml(clientName);
  const safeRedirectUri = escapeHtml(redirectUri);
  const safeConsentId = escapeHtml(consentId);
  const safeCsrfToken = escapeHtml(csrfToken);
  return layout("Authorize access | MCP Server for YNAB", `
<h1>Authorize <span class="accent">${safeClientName}</span></h1>
<div class="card">
<p>The MCP client <code>${safeClientName}</code> (redirect: <code>${safeRedirectUri}</code>) is asking to access your YNAB budget through this connector.</p>
<p>Continuing sends you to <strong>YNAB's own sign-in page</strong>. Your YNAB credentials and tokens stay server-side; the AI client only ever receives this connector's own token.</p>
<form method="post" action="/authorize">
  <input type="hidden" name="consent" value="${safeConsentId}">
  <input type="hidden" name="csrf" value="${safeCsrfToken}">
  <label><input type="checkbox" name="writes" value="1"> Allow <strong>write access</strong> (create, edit, approve, and delete transactions; destructive tools still require per-call confirmation). Leave unchecked for read-only.</label>
  <button type="submit">Continue to YNAB</button>
</form>
</div>`, { origin });
}

export function finalConsentPage({ clientName, redirectUri, writesEnabled, purpose, finalId, csrfToken, origin = CONNECTOR_ORIGIN }) {
  const deleting = purpose === "delete";
  const safeClientName = escapeHtml(clientName || "YNAB");
  const safeRedirectUri = escapeHtml(redirectUri || "connector data deletion");
  const safeFinalId = escapeHtml(finalId);
  const safeCsrfToken = escapeHtml(csrfToken);
  const accessLabel = writesEnabled ? "Read and write access" : "Read-only access";
  const heading = deleting ? "Confirm data deletion" : `Finish connecting <span class="accent">${safeClientName}</span>`;
  const action = deleting
    ? "Delete the connector's stored tokens, undo journal, and grants for this YNAB account."
    : `Create the connector grant for <code>${safeClientName}</code> (redirect: <code>${safeRedirectUri}</code>) with <strong>${accessLabel}</strong>.`;
  const button = deleting ? "Delete my connector data" : "Finish connecting";
  return layout("Final confirmation | MCP Server for YNAB", `
<h1>${heading}</h1>
<div class="card">
<p>Your YNAB sign-in succeeded. Review this final connector action before anything is granted to the MCP client.</p>
<p>${action}</p>
<form method="post" action="/callback">
  <input type="hidden" name="finalize" value="${safeFinalId}">
  <input type="hidden" name="csrf" value="${safeCsrfToken}">
  <button type="submit">${button}</button>
</form>
</div>`, { origin });
}

export function privacyPage({ origin = CONNECTOR_ORIGIN } = {}) {
  return layout("Privacy | MCP Server for YNAB", `
<h1>Privacy policy</h1>
<p class="muted"><strong>Last updated:</strong> October 9, 2026</p>
<div class="card">
<p><strong>Storage and Cloudflare:</strong> the connector stores your YNAB OAuth access and refresh tokens, YNAB user ID, MCP client ID, consent credential ID, read-only/write choice, and operation/undo journals of connector-performed writes (operation and transaction IDs, relevant before/after field values, and recovery status). Credentials and journals are separate for each consent. Cloudflare hosts the Worker and provides the Durable Objects and Workers KV storage used by the connector. Tokens and journals are encrypted with AES-GCM before they enter durable storage. Older shared encrypted records remain inaccessible in KV until deletion.</p>
<p><strong>Retention:</strong> encrypted token records, authorization grants, and undo entries are retained until you use <a href="/delete">the deletion page</a>. Temporary OAuth consent and callback state expires automatically within 10 minutes.</p>
<p><strong>Data delivery:</strong> when you make an MCP request, the connector exchanges OAuth and budget data with YNAB (including <code>app.ynab.com</code> for sign-in and <code>api.ynab.com</code> for API requests) and returns the result to the MCP client you connected. That client may receive budget data returned by the tool; its handling is governed by its own terms and privacy policy.</p>
<p><strong>Session memory:</strong> ordinary budget results may be cached temporarily for read performance and are not written to durable storage. Writes re-read relevant state. Because some clients open a new MCP session for every request, an expiring write preview is stored with your connection as a one-way hash of its token, a fingerprint of the proposed change and its expiry time, for at most five minutes. The proposed changes themselves are not stored, a preview can be used once, and previews are deleted when you disconnect or delete your data.</p>
<p><strong>What it does not do:</strong> store your YNAB password, sell your data, use budget data for advertising, or persist ordinary budget results outside the encrypted credential and operation/undo records described above.</p>
<p><strong>Deletion:</strong> use <a href="/delete">the deletion page</a> to revoke this connector's grants and erase stored tokens and journal entries. You can also revoke the application from your YNAB account settings.</p>
<p>A non-financial deletion marker remains to invalidate earlier pending consent forms. An authorization already in progress can briefly leave an unusable provider grant while revocation propagates; the removed credential cannot make API requests.</p>
<p><strong>Contact:</strong> file an issue at <a href="https://github.com/oliverames/ynab-mcp-server/issues">github.com/oliverames/ynab-mcp-server</a>.</p>
</div>`, { origin, canonicalPath: "/privacy" });
}

export function deletePage({ csrfToken, origin = CONNECTOR_ORIGIN } = {}) {
  return layout("Delete my data | MCP Server for YNAB", `
<h1>Delete my data</h1>
<div class="card">
<p>To erase everything this connector stores about you (tokens, undo journal, authorization grants), verify ownership by signing in with YNAB once more:</p>
<form method="post" action="/delete">
  <input type="hidden" name="csrf" value="${escapeHtml(csrfToken)}">
  <button type="submit">Sign in with YNAB and delete my data</button>
</form>
<p>Also revoke the application in YNAB: <strong>Account Settings → Apps / Developer Settings</strong> → revoke “MCP Server for YNAB”.</p>
</div>`, { origin, canonicalPath: "/delete" });
}

export function deletedPage({ origin = CONNECTOR_ORIGIN } = {}) {
  return layout("Data deleted | MCP Server for YNAB", `
<h1>Data deleted</h1>
<div class="card">
<p>All stored tokens, undo journal entries, and authorization grants for your YNAB user have been removed. Remember to also revoke the application in YNAB's Account Settings.</p>
</div>`, { origin });
}

export function errorPage(message, { origin = CONNECTOR_ORIGIN } = {}) {
  return layout("Error | MCP Server for YNAB", `
<h1>Something went wrong</h1>
<div class="card"><p>${escapeHtml(message)}</p><p><a href="/">Back to the landing page</a></p></div>`, { origin });
}
