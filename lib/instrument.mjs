// Imported first by index.js so Sentry is initialized before the rest of the
// server loads. A no-op unless SENTRY_DSN is set; never active in Workers.
import { initErrorReporting } from "./error-reporting.mjs";

if (globalThis.navigator?.userAgent !== "Cloudflare-Workers" && process.env.SENTRY_DSN) {
  await initErrorReporting();
}
