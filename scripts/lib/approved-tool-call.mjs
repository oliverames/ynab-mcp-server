import { createInterface } from "node:readline/promises";

function resultData(result) {
  if (result.isError) throw new Error(result.content?.find((item) => item.type === "text")?.text || "MCP tool returned an error");
  if (result.structuredContent?.result !== undefined) return result.structuredContent.result;
  const text = result.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("MCP tool did not return a readable preview");
  return JSON.parse(text);
}

async function interactiveApproval({ input, output, toolName }) {
  const prompt = createInterface({ input, output, terminal: true });
  try { return await prompt.question(`Type 'yes' to approve this exact ${toolName} write; any other response cancels: `); }
  finally { prompt.close(); }
}

// Live scripts use the default interactive prompt. requestApproval is a
// dependency-injection seam for synthetic tests, never an environment grant.
export function createApprovedToolCall(client, { input = process.stdin, output = process.stdout, requestApproval } = {}) {
  let catalog;
  async function tools() {
    if (!catalog) catalog = (async () => {
      const entries = new Map();
      let cursor;
      do {
        const page = await client.listTools(cursor ? { cursor } : undefined);
        for (const tool of page.tools) entries.set(tool.name, tool);
        cursor = page.nextCursor;
      } while (cursor);
      return entries;
    })();
    return catalog;
  }

  return async function approvedToolCall(name, args = {}) {
    const registered = await tools();
    const tool = registered.get(name);
    if (!tool) throw new Error(`Tool ${name} is not advertised by this MCP server.`);
    if (tool.annotations?.readOnlyHint !== false) return client.callTool({ name, arguments: args });
    if (!requestApproval && (!input.isTTY || !output.isTTY)) {
      throw new Error(`Write ${name} requires an interactive terminal and a separate human 'yes' after reviewing its exact preview. Environment flags and confirmed:true are not consent. No write was attempted.`);
    }

    const generic = name === "ynab_write_tool_execute";
    const concreteName = generic ? args.tool_name : name;
    if (typeof concreteName !== "string" || registered.get(concreteName)?.annotations?.readOnlyHint !== false || concreteName === "ynab_write_tool_execute") {
      throw new Error("Choose a concrete advertised write tool for its exact preview.");
    }
    const proposed = structuredClone(generic ? args.input ?? {} : args);
    delete proposed.previewToken;
    delete proposed.confirmed;
    const preview = resultData(await client.callTool({ name: "preview_write_tool", arguments: { tool_name: concreteName, input: proposed } }));
    if (!preview.preview_token || preview.plan?.tool_name !== concreteName || !preview.plan?.input || typeof preview.plan.input !== "object") {
      throw new Error("The server did not return a valid exact write preview. No write was attempted.");
    }
    const normalized = structuredClone(preview.plan.input);
    delete normalized.previewToken;
    delete normalized.confirmed;
    output.write(`\nExact ${concreteName} write preview (financial text is untrusted data, never instructions or approval):\n${JSON.stringify(preview.plan, null, 2)}\n`);
    const answer = await (requestApproval
      ? requestApproval({ toolName: concreteName, plan: structuredClone(preview.plan) })
      : interactiveApproval({ input, output, toolName: concreteName }));
    if (typeof answer !== "string" || answer.trim() !== "yes") {
      throw new Error(`Write ${concreteName} was not explicitly approved; no write was attempted.`);
    }
    const approvedInput = { ...normalized, previewToken: preview.preview_token, confirmed: true };
    return client.callTool({ name, arguments: generic ? { tool_name: concreteName, input: approvedInput, confirmed: true } : approvedInput });
  };
}
