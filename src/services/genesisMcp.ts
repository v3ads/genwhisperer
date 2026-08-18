/**
 * Genesis MCP gateway client (server-side, V2).
 *
 * Ports the v12 browser client + the estate-genesis skill's genesis.py
 * connection pattern to TypeScript. The Express agent runtime uses this to
 * drive a user's Genesis project: JSON-RPC 2.0 over HTTP POST to the
 * project-scoped MCP URL, authenticated with a one-time x-agent-token.
 *
 * Connection pattern (from docs/v12-reference.html + estate-genesis skill):
 *  - URL: https://genesis.estage.com/api/agent/<projectId>/mcp
 *  - Auth header: x-agent-token: <one-time-token>
 *  - Protocol: JSON-RPC 2.0, MCP protocol version 2024-11-05
 *  - Handshake: initialize → notifications/initialized → tools/list → tools/call
 *  - Response may be JSON or SSE (text/event-stream); parse both.
 *
 * All keys/tokens are passed in by the caller (the agent route decrypts them
 * from Neon) and never persisted here. Timeouts via AbortController (30s per
 * call) so a stalled gateway can't hang the agent loop.
 */

const PROTOCOL_VERSION = "2024-11-05";
const CLIENT_NAME = "genwhisperer-v2";
const CLIENT_VERSION = "1.0.0";
const DEFAULT_TIMEOUT_MS = 30_000;

/** A Genesis MCP tool definition as returned by tools/list. */
export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

/** Result of a successful tools/call. */
export interface McpCallResult {
  /** The joined text content from the MCP content array. */
  text: string;
  /** True when the MCP response flagged this as an error. */
  isError: boolean;
}

/** A per-project Genesis MCP client. Create one per agent run. */
export class GenesisMcpClient {
  private rpcId = 0;
  private initialized = false;
  private readonly mcpUrl: string;
  private readonly token: string;

  constructor(mcpUrl: string, token: string) {
    this.mcpUrl = mcpUrl;
    this.token = token;
  }

  private nextId(): number {
    return ++this.rpcId;
  }

  private headers(): Record<string, string> {
    return {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
      "x-agent-token": this.token,
    };
  }

  /**
   * Run the initialize → notifications/initialized handshake.
   * Idempotent within a client instance.
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;
    await this.post({
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "initialize",
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: CLIENT_NAME, version: CLIENT_VERSION },
      },
    });
    // notifications/initialized — no response expected; ignore failures.
    try {
      await fetch(this.mcpUrl, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
      });
    } catch {
      /* no-op */
    }
    this.initialized = true;
  }

  /** List the tools the connected Genesis project exposes. */
  async listTools(): Promise<McpTool[]> {
    await this.initialize();
    const j = (await this.post({
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tools/list",
      params: {},
    })) as { result?: { tools?: McpTool[] } };
    return j?.result?.tools || [];
  }

  /**
   * Call a Genesis tool by name with the given arguments.
   * Throws { toolError: true } when the MCP response flags isError.
   * Throws with .code = 401 on auth failure (wrong/revoked/consumed token).
   */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    await this.initialize();
    const j = (await this.post({
      jsonrpc: "2.0",
      id: this.nextId(),
      method: "tools/call",
      params: { name, arguments: args || {} },
    })) as { result?: McpCallResult; content?: unknown; isError?: boolean };
    const result = (j?.result || j) as McpCallResult & {
      content?: Array<{ type?: string; text?: string }>;
      isError?: boolean;
    };
    if (result && Array.isArray(result.content)) {
      const texts = result.content
        .filter((c) => c.type === "text")
        .map((c) => c.text || "");
      const text = texts.join("\n");
      if (result.isError) {
        const e = new Error(text || "Tool error") as Error & { toolError: true };
        e.toolError = true;
        throw e;
      }
      return { text, isError: false };
    }
    return { text: JSON.stringify(result, null, 2), isError: false };
  }

  /**
   * POST one JSON-RPC request and parse the response.
   * Handles JSON, SSE (text/event-stream), and the 401 one-time-token case.
   */
  private async post(body: unknown, timeoutMs = DEFAULT_TIMEOUT_MS): Promise<unknown> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    let r: Response;
    try {
      r = await fetch(this.mcpUrl, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: ctrl.signal,
      });
    } catch (e) {
      const err = e as Error;
      if (err.name === "AbortError") {
        throw new Error(`Genesis request timed out (${timeoutMs / 1000}s).`);
      }
      throw new Error(`Genesis unreachable: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    if (r.status === 401) {
      let msg = "Invalid agent token";
      try {
        const j = (await r.json()) as { error?: { message?: string } };
        msg = j.error?.message || msg;
      } catch {
        /* keep default */
      }
      const e = new Error(
        `Genesis auth failed (401): ${msg}. The token may be wrong, revoked, or already ` +
          `consumed (Estage tokens are one-time-use). Generate a fresh one in Genesis > ` +
          `Integrations > Claude Code.`
      ) as Error & { code: number };
      e.code = 401;
      throw e;
    }
    if (r.status >= 400) {
      const t = await r.text().catch(() => "");
      throw new Error(`Genesis HTTP ${r.status}: ${t.slice(0, 300)}`);
    }

    const txt = await r.text();
    return parseMcpBody(txt);
  }
}

/**
 * Parse a Genesis MCP response body that may be either JSON or SSE.
 * Mirrors the v12 parseBody(): try whole-body JSON first, then scan for a
 * `data:` line and parse that.
 */
export function parseMcpBody(body: string): unknown {
  if (!body) return null;
  try {
    return JSON.parse(body);
  } catch {
    /* fall through to SSE scan */
  }
  for (const line of body.split("\n")) {
    if (line.startsWith("data:")) {
      try {
        return JSON.parse(line.slice(5).trim());
      } catch {
        /* keep scanning */
      }
    }
  }
  return null;
}

/**
 * Validate a Genesis project connection by running the handshake + tools/list.
 * Used by the projects route before storing a token, mirroring v1's
 * "validate the OpenRouter key before saving" pattern. Returns the tool list
 * on success; throws on auth/network failure.
 */
export async function validateGenesisConnection(
  mcpUrl: string,
  token: string
): Promise<{ tools: McpTool[] }> {
  const client = new GenesisMcpClient(mcpUrl, token);
  const tools = await client.listTools();
  return { tools };
}

/**
 * Extract the numeric Genesis project id from an MCP URL like
 * https://genesis.estage.com/api/agent/75572/mcp → "75572".
 * Returns null if the URL doesn't match the expected shape.
 */
export function parseGenesisProjectId(mcpUrl: string): string | null {
  const m = mcpUrl.match(/\/api\/agent\/([^/]+)\/mcp/);
  return m ? m[1] : null;
}
