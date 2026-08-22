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
  const lower = toolName.toLowerCase();

  if (lower.endsWith("write_file")) {
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

  if (lower.endsWith("edit_file")) {
    if (typeof args.path !== "string" || !args.path.trim()) {
      return {
        allowed: false,
        errorName: "InvalidToolArguments",
        message: "A file path is required before Genesis can edit a file.",
      };
    }
    if (typeof args.old_string !== "string" || !args.old_string.trim()) {
      return {
        allowed: false,
        errorName: "InvalidToolArguments",
        message:
          "The old_string (the exact text to replace) is missing, so Genesis cannot edit this file safely.",
      };
    }
    if (typeof args.new_string !== "string" || args.new_string.trim().length === 0) {
      return {
        allowed: false,
        errorName: "InvalidToolArguments",
        message:
          "The new_string (the replacement text) is missing, so Genesis cannot edit this file safely.",
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
