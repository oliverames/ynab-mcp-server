import { credentialIdentity, createKvJournal, getFreshAccessToken, isCredentialBinding, randomToken } from "./ynab-oauth.js";

export function hostedServerOptions(env, props, sessionId = randomToken(24)) {
  const bound = isCredentialBinding(props);
  const identity = bound ? credentialIdentity(props) : "legacy-reauthorization-required";
  return {
    getAccessToken: () => getFreshAccessToken(env, props),
    hasCredentials: bound,
    writesEnabled: bound && props.writesEnabled,
    tenantId: identity,
    sessionId: `${identity}:${sessionId}`,
    ...(bound ? { journal: createKvJournal(env, props) } : {}),
    runtime: {
      tokenSource: { source: "ynab_oauth", source_label: "YNAB OAuth (isolated hosted consent)" },
      detected_agent: "remote",
      config_fallback_disabled: true,
      sources_checked: [],
      values: {},
      tokenLookupError: bound ? null : "Reconnect this connector in your MCP client. Its older shared OAuth credential cannot be assigned safely to this client or access scope.",
      setupGuide: {
        prompt_for_agent: "Ask the user to reconnect the YNAB connector in their MCP client and approve the required access on its consent screen. Do not request or share a personal access token.",
      },
    },
  };
}
