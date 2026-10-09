# 6.0.1 hosted startup correction

6.0.1 contains all [6.0 features and client migration requirements](release-6.0.0.md)
and corrects shared-module initialization for Cloudflare Workers. The unused
default stdio server is now skipped in Workers; actual authenticated server
instances still start inside McpAgent.init. Node stdio and independent factory
instances retain random session identities. No fixed/shared session identity is
introduced.

Cloudflare rejected the 6.0.0 upload before activation because constructing the
default stdio server generated a random UUID at global scope. Production
readback confirmed that its v2 deployment, bindings, domain and settings were
unchanged. The correction passes regressions blocking global randomness, timers
and fetch, plus actual local workerd startup/public/unauthenticated MCP checks
using synthetic configuration and isolated local bindings.

The v3 encrypted consent credential/journal store and hosted reconnect requirement
remain part of the approved rollout. Cloudflare blocks rollback to pre-v3, so
repairs retain the class, migration and encrypted state. Existing grants become
discovery-only until reconnect; a new consent cannot adopt unresolved operations
from an old consent. Reconcile those operations first.

Publish this patch from a clean committed source after CI, then verify registry
gitHead, SRI and every published source file, GitHub tag/MCPB integrity and
credential-free runtime discovery. Read back the production version, full source
SHA, migration v3, twelve bindings, preserved domain/settings and public health.
No live financial operation or new grant is part of verification. Authenticated
live acceptance remains in #24, and billing-control review remains in #34.
