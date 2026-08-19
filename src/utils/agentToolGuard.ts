export type ToolCallGuardResult =
  | { allowed: true }
  | { allowed: false; errorName: "InvalidToolArguments" | "DuplicateToolCallBlocked"; message: string };

/**
 * Validates tool calls before Genesis receives them and blocks a repeated
 * identical call within a single agent run.
 */
export function guardAgentToolCall(
  attempts: Map<string, number>,
  toolName: string,
  args: Record<string, unknown>
): ToolCallGuardResult {
  if (toolName.toLowerCase().endsWith("write_file")) {
    if (typeof args.path !== "string" || !args.path.trim()) {
      return {
        allowed: false,
        errorName: "InvalidToolArguments",
        message: "A file path is required before Genesis can write a file.",
      };
    }
    if (typeof args.content !== "string" || !args.content.trim()) {
      return {
        allowed: false,
        errorName: "InvalidToolArguments",
        message: "The file content is missing, so Genesis cannot write this file safely.",
      };
    }
  }

  let key: string;
  try {
    key = `${toolName}:${JSON.stringify(args)}`;
  } catch {
    key = toolName;
  }

  if ((attempts.get(key) ?? 0) >= 1) {
    return {
      allowed: false,
      errorName: "DuplicateToolCallBlocked",
      message: "I couldn’t complete a Genesis operation after a corrected attempt. I stopped here to avoid repeating the same change.",
    };
  }

  attempts.set(key, (attempts.get(key) ?? 0) + 1);
  return { allowed: true };
}
