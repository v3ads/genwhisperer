/**
 * Genesis tool definitions for the agent loop (V2).
 *
 * IMPORTANT architectural note (from the v12 reference): the Genesis tool set
 * is NOT hardcoded — it is discovered DYNAMICALLY per project via the MCP
 * tools/list call. Different Genesis projects expose different tools. So this
 * module converts a live McpTool[] (fetched from the user's project) into the
 * OpenRouter function-tool schema, and appends the one static tool we add:
 * estage_kb_query.
 *
 * This is why genesisTools.ts is a converter, not a static list. The ~64-tool
 * payload mentioned in the spec is the typical size after conversion; the
 * agent loop calls tools/list once per run and builds the schema from it.
 */

import type { McpTool } from "../services/genesisMcp.js";
import type { OrTool } from "../services/openrouter.js";

/** The static estage_kb_query tool definition (the one tool we add ourselves). */
export const ESTAGE_KB_QUERY_TOOL: OrTool = {
  type: "function",
  function: {
    name: "estage_kb_query",
    description:
      "Query the official eStage knowledge base (knowledge.estage.com) for a grounded, " +
      "cited answer about eStage/Genesis platform capabilities and the correct approach " +
      "for a task. Use this BEFORE uncertain Genesis write/edit/publish/provision " +
      "operations to verify feasibility and the right method. Returns the answer plus " +
      "source citations.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description:
            "Natural-language question about eStage/Genesis capabilities or how to do something on the platform.",
        },
        top_k: {
          type: "integer",
          description:
            "Number of KB chunks to ground the answer (default 5, use 8 for capability-mapping).",
          default: 5,
        },
      },
      required: ["question"],
    },
  },
};

/**
 * Convert the live Genesis MCP tool list (from tools/list) into the OpenRouter
 * function-tool schema, and append the estage_kb_query tool. Descriptions are
 * truncated to 1800 chars (OpenRouter tool-description limit, per v12).
 */
export function genesisToolsToOrTools(genesisTools: McpTool[]): OrTool[] {
  const tools: OrTool[] = genesisTools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: (t.description || "").slice(0, 1800),
      parameters:
        t.inputSchema && Object.keys(t.inputSchema).length
          ? t.inputSchema
          : { type: "object", properties: {} },
    },
  }));
  tools.push(ESTAGE_KB_QUERY_TOOL);
  return tools;
}

/**
 * High-impact Genesis tools that warrant a user confirmation gate before
 * execution (publish/delete/migrate/provision/SSR/subdomain/tracking).
 * genesis_cloud_sql is confirmable only when allowWrite is true — handled in
 * the agent loop's tool dispatch.
 */
export const CONFIRM_TOOLS = new Set([
  "genesis_publish",
  "genesis_delete_file",
  "genesis_apply_patch",
  "genesis_cloud_migrate",
  "genesis_provision_element",
  "genesis_subdomain_connect",
  "genesis_ssr_publish",
  "genesis_tracking_set",
]);

/**
 * Does a given tool call require user confirmation?
 * (CONFIRM_TOOLS, plus genesis_cloud_sql only when args.allowWrite is truthy.)
 */
export function needsConfirmation(
  toolName: string,
  args: Record<string, unknown>
): boolean {
  if (CONFIRM_TOOLS.has(toolName)) return true;
  if (toolName === "genesis_cloud_sql" && args && args.allowWrite) return true;
  return false;
}
