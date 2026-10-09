import { DurableObject } from "cloudflare:workers";
import { CredentialStoreCore } from "./credential-store-core.js";

export class OAuthCredentials extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.core = new CredentialStoreCore(ctx.storage, env);
  }

  fetch(request) {
    return this.core.fetch(request);
  }
}
