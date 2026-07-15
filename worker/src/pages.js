// Static page bodies for the connector. Every page carries non-affiliation
// language per docs/hosted-oauth-connector.md and YNAB's naming guidance.

const NON_AFFILIATION = "MCP Server for YNAB is an independent open-source project by Oliver Ames. It is not an official YNAB product and is not affiliated with, sponsored by, or endorsed by YNAB (You Need A Budget, LLC).";

function layout(title, body) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; max-width: 44rem; margin: 3rem auto; padding: 0 1rem 3rem; line-height: 1.55; color: #1c1c1c; }
  h1 { font-size: 1.5rem; } code { background: #f4f4f4; padding: .1em .35em; border-radius: 4px; }
  .card { border: 1px solid #ddd; border-radius: 12px; padding: 1.25rem 1.5rem; background: #fff; }
  .accent { color: #b8791f; } .muted { color: #555; font-size: .9rem; }
  button, .btn { background: #f5a542; border: none; border-radius: 8px; padding: .6rem 1.2rem; font-size: 1rem; cursor: pointer; }
  label { display: block; margin: .75rem 0; }
  footer { margin-top: 2.5rem; font-size: .85rem; color: #666; border-top: 1px solid #eee; padding-top: 1rem; }
</style>
</head>
<body>
${body}
<footer>${NON_AFFILIATION}<br>Support: <a href="https://github.com/oliverames/ynab-mcp-server/issues">github.com/oliverames/ynab-mcp-server</a> &middot; <a href="/privacy">Privacy</a> &middot; <a href="/delete">Delete my data</a></footer>
</body>
</html>`;
}

export function landingPage() {
  return layout("MCP Server for YNAB — Remote Connector", `
<h1><span class="accent">MCP Server for YNAB</span> — remote connector</h1>
<div class="card">
<p>This is a remote <a href="https://modelcontextprotocol.io">Model Context Protocol</a> endpoint for YNAB budgets. Add it to an MCP-capable AI client and authorize with your own YNAB account — no personal access token to copy anywhere.</p>
<p><strong>Endpoint:</strong> <code>https://ynab.amesvt.com/mcp</code> (streamable HTTP; legacy SSE at <code>/sse</code>)</p>
<p>Your AI client will walk you through YNAB's own sign-in and consent. You choose at consent time whether the connection can write to your budget or stay read-only.</p>
<p class="muted">Source code, tool reference, and the local stdio version: <a href="https://github.com/oliverames/ynab-mcp-server">oliverames/ynab-mcp-server</a>.</p>
</div>`);
}

export function consentPage({ clientName, redirectUri, encodedReqInfo, csrfToken }) {
  return layout("Authorize access — MCP Server for YNAB", `
<h1>Authorize <span class="accent">${clientName}</span></h1>
<div class="card">
<p>The MCP client <code>${clientName}</code> (redirect: <code>${redirectUri}</code>) is asking to access your YNAB budget through this connector.</p>
<p>Continuing sends you to <strong>YNAB's own sign-in page</strong>. Your YNAB credentials and tokens stay server-side; the AI client only ever receives this connector's own token.</p>
<form method="post" action="/authorize">
  <input type="hidden" name="req" value="${encodedReqInfo}">
  <input type="hidden" name="csrf" value="${csrfToken}">
  <label><input type="checkbox" name="writes" value="1"> Allow <strong>write access</strong> (create, edit, approve, and delete transactions — destructive tools still require per-call confirmation). Leave unchecked for read-only.</label>
  <button type="submit">Continue to YNAB</button>
</form>
</div>`);
}

export function privacyPage() {
  return layout("Privacy — MCP Server for YNAB", `
<h1>Privacy policy</h1>
<div class="card">
<p><strong>What this connector stores:</strong> your YNAB OAuth access and refresh tokens (encrypted at rest), your YNAB user ID, your read-only/write choice, and an undo journal of writes this connector performed (transaction IDs and the changed field values needed to reverse them). Nothing else is retained.</p>
<p><strong>What it never does:</strong> store your YNAB password (authentication happens on ynab.com), sell or share data, use budget data for anything other than serving your own MCP requests, or send data to any host other than <code>api.ynab.com</code>.</p>
<p><strong>Transport:</strong> budget data flows from YNAB through this connector to your MCP client only during your requests; it is not logged or persisted beyond the undo journal described above.</p>
<p><strong>Deletion:</strong> use <a href="/delete">the deletion page</a> to revoke this connector's grants and erase stored tokens and journal entries, and additionally revoke the application from your YNAB account settings.</p>
<p><strong>Contact:</strong> file an issue at <a href="https://github.com/oliverames/ynab-mcp-server/issues">github.com/oliverames/ynab-mcp-server</a>.</p>
</div>`);
}

export function deletePage() {
  return layout("Delete my data — MCP Server for YNAB", `
<h1>Delete my data</h1>
<div class="card">
<p>To erase everything this connector stores about you (tokens, undo journal, authorization grants), verify ownership by signing in with YNAB once more:</p>
<form method="post" action="/delete">
  <button type="submit">Sign in with YNAB and delete my data</button>
</form>
<p>Also revoke the application in YNAB: <strong>Account Settings → Apps / Developer Settings</strong> → revoke “MCP Server for YNAB”.</p>
</div>`);
}

export function deletedPage() {
  return layout("Data deleted — MCP Server for YNAB", `
<h1>Data deleted</h1>
<div class="card">
<p>All stored tokens, undo journal entries, and authorization grants for your YNAB user have been removed. Remember to also revoke the application in YNAB's Account Settings.</p>
</div>`);
}

export function errorPage(message) {
  return layout("Error — MCP Server for YNAB", `
<h1>Something went wrong</h1>
<div class="card"><p>${message}</p><p><a href="/">Back to the landing page</a></p></div>`);
}
