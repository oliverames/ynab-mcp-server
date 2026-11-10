// Shared helpers for the YNAB MCP App views. Every string from tool data goes in through
// textContent (see h()); nothing in this file builds HTML from data.
const { App, applyDocumentTheme, applyHostStyleVariables, applyHostFonts } = __mcp;
const ICONS = {
  chevron: "M9 6l6 6-6 6",
  left: "M15 6l-6 6 6 6",
  right: "M9 6l6 6-6 6",
  expand: "M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7",
  check: "M8 12l3 3 5-6M12 21a9 9 0 100-18 9 9 0 000 18z",
  alert: "M12 8v5M12 16.5v.01M10.3 3.9L2.5 17.5a2 2 0 001.7 3h15.6a2 2 0 001.7-3L13.7 3.9a2 2 0 00-3.4 0z",
  circle: "M12 21a9 9 0 100-18 9 9 0 000 18z",
  lock: "M7 11V8a5 5 0 0110 0v3M6 11h12v9H6z",
  flag: "M5 21V4M5 4h11l-2 4 2 4H5",
  clock: "M12 7v5l3 2M12 21a9 9 0 100-18 9 9 0 000 18z",
  send: "M4 12l16-8-6 16-3-7z",
};
const SVG_NS = "http://www.w3.org/2000/svg";
function icon(name) {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("class", "ic");
  svg.setAttribute("aria-hidden", "true");
  for (const d of ICONS[name].split("|")) {
    const path = document.createElementNS(SVG_NS, "path");
    path.setAttribute("d", d);
    svg.append(path);
  }
  return svg;
}
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "text") el.textContent = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(typeof kid === "object" ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const view = { locale: undefined, displayMode: "inline", canFullscreen: false, canCallTools: false, args: {} };
function money(value, currency) {
  const n = Number(value);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat(view.locale, { style: "currency", currency: currency || "USD" }).format(Math.round(n * 100) / 100);
  } catch { return "$" + (Math.round(n * 100) / 100).toFixed(2); }
}
const cents = (v) => Math.round((Number(v) || 0) * 100);
function parseResult(res) {
  if (!res) return { error: "No data." };
  const text = res.content?.find?.((c) => c?.type === "text")?.text;
  if (res.isError) return { error: text || "The tool returned an error." };
  const sc = res.structuredContent;
  if (sc && "result" in sc) return { data: sc.result };
  if (sc) return { data: sc };
  if (text) { try { return { data: JSON.parse(text) }; } catch { return { error: text }; } }
  return { error: "No data." };
}
function createView(name, { onData, onLayout }) {
  const app = new App({ name, version: "1.0.0" }, { availableDisplayModes: ["inline", "fullscreen"] });
  const applyContext = (ctx) => {
    if (!ctx) return;
    try { if (ctx.theme) applyDocumentTheme(ctx.theme); } catch {}
    try { if (ctx.styles?.variables) applyHostStyleVariables(ctx.styles.variables); } catch {}
    try { if (ctx.styles?.css?.fonts) applyHostFonts(ctx.styles.css.fonts); } catch {}
    if (ctx.locale) view.locale = ctx.locale;
    if (ctx.displayMode) view.displayMode = ctx.displayMode;
    const inset = ctx.safeAreaInsets;
    if (inset) document.body.style.padding = `${8 + inset.top}px ${8 + inset.right}px ${8 + inset.bottom}px ${8 + inset.left}px`;
    view.canFullscreen = (ctx.availableDisplayModes || []).includes("fullscreen");
    document.body.classList.toggle("fs", view.displayMode === "fullscreen");
  };
  app.ontoolinput = (p) => { if (p?.arguments) view.args = p.arguments; };
  app.ontoolresult = (res) => { onData(parseResult(res)); };
  app.onhostcontextchanged = (ctx) => { applyContext(ctx); onLayout(); };
  (async () => {
    try {
      await app.connect();
      applyContext(app.getHostContext());
      view.canCallTools = !!app.getHostCapabilities()?.serverTools;
      onLayout();
    } catch (e) {
      onData({ error: "This view only runs inside a host that supports MCP Apps." });
    }
  })();
  return app;
}
// Ask Claude to do something. This never writes to YNAB: the message only requests a proposal,
// so preview_write_tool and the human confirmation step remain the single write path.
async function askClaude(app, text, statusEl) {
  const say = (m) => { statusEl.textContent = m; };
  try {
    const r = await app.sendMessage({ role: "user", content: [{ type: "text", text: text.slice(0, 7900) }] });
    say(r?.isError ? "Claude didn't take the request. You can try again." : "Sent to Claude. Check the conversation to review and approve.");
  } catch {
    say("The request couldn't be confirmed. Check the conversation before trying again.");
  }
}
function fullscreenButton(app) {
  if (!view.canFullscreen || view.displayMode === "fullscreen") return null;
  return h("button", { class: "iconbtn", type: "button", "aria-label": "Open full screen", title: "Open full screen",
    onclick: () => app.requestDisplayMode({ mode: "fullscreen" }).catch(() => {}) }, icon("expand"));
}
function skeleton() { return h("div", { class: "skel", "aria-busy": "true" }, h("i"), h("i"), h("i"), h("i")); }
