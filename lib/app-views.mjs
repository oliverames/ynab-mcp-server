// Read-only MCP App views (ui:// resources) for Claude and other MCP Apps hosts.
//
// Each view is a single self-contained HTML document: the stylesheet, the view script and the
// MCP Apps client bundle are inlined, so nothing loads from the network and no CSP origins are
// declared. The views render the structuredContent that get_month and review_unapproved already
// return. They never call a write tool; their buttons use sendMessage to ask Claude for a
// proposal, so preview_write_tool plus human confirmation stays the only write path.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { registerAppResource, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";

export const BUDGET_OVERVIEW_URI = "ui://ynab/budget-overview";
export const TRANSACTION_REVIEW_URI = "ui://ynab/transaction-review";

// Tool name -> view resource. Only these read tools carry _meta.ui.resourceUri.
export const APP_VIEW_TOOLS = {
  get_month: BUDGET_OVERVIEW_URI,
  review_unapproved: TRANSACTION_REVIEW_URI,
};

const VIEW_FILES = {
  [BUDGET_OVERVIEW_URI]: "budget-overview.html",
  [TRANSACTION_REVIEW_URI]: "transaction-review.html",
};

// Standard key plus the legacy flat key that registerAppTool also writes.
export function appToolMeta(uri) {
  return { ui: { resourceUri: uri }, "ui/resourceUri": uri };
}

const viewText = (name) => readFileSync(new URL(`./app-views/${name}`, import.meta.url), "utf8");
let clientBundle;

// The prebuilt MCP Apps client (zod included, no eval). Its final `export{...}` is rewritten to
// a local binding so the view scripts can share one inline module scope.
function loadClientBundle() {
  if (clientBundle) return clientBundle;
  let src = readFileSync(createRequire(import.meta.url).resolve("@modelcontextprotocol/ext-apps/app-with-deps"), "utf8");
  const match = /export\s*\{([^}]*)\}\s*;?\s*$/.exec(src);
  if (!match) throw new Error("Unexpected MCP Apps client bundle format.");
  const local = Object.fromEntries(match[1].split(",").map((part) => {
    const [from, to] = part.trim().split(/\s+as\s+/);
    return [to ?? from, from];
  }));
  const wanted = ["App", "applyDocumentTheme", "applyHostStyleVariables", "applyHostFonts"];
  for (const name of wanted) if (!local[name]) throw new Error(`MCP Apps client bundle lacks ${name}.`);
  // Wrapped in a function so the bundle's minified top-level names cannot collide with the view script.
  src = `const __mcp=(()=>{${src.slice(0, match.index)}\nreturn {${wanted.map((n) => `${n}:${local[n]}`).join(",")}};})();`;
  clientBundle = src.replaceAll("</script", "<\\/script");
  return clientBundle;
}

export function buildViewHtml(uri) {
  const file = VIEW_FILES[uri];
  if (!file) throw new Error(`Unknown view ${uri}`);
  return viewText(file)
    .split("/*SHARED_CSS*/").join(viewText("shared.css"))
    .split("/*SHARED_JS*/").join(viewText("shared.js"))
    .split("/*APP_BUNDLE*/").join(loadClientBundle());
}

const htmlCache = new Map();
function html(uri) {
  if (!htmlCache.has(uri)) htmlCache.set(uri, buildViewHtml(uri));
  return htmlCache.get(uri);
}

export function registerAppViews(server) {
  const views = [
    [BUDGET_OVERVIEW_URI, "YNAB budget overview", "Read-only month view: Ready to Assign, category groups, budgeted, activity and available pills, goal progress. Shown for get_month."],
    [TRANSACTION_REVIEW_URI, "YNAB transaction review", "Read-only table of unapproved and uncategorized transactions with flags, cleared state and totals. Shown for review_unapproved."],
  ];
  for (const [uri, title, description] of views) {
    registerAppResource(server, title, uri, { title, description }, async () => ({
      contents: [{ uri, mimeType: RESOURCE_MIME_TYPE, text: html(uri), _meta: { ui: { prefersBorder: false } } }],
    }));
  }
}
