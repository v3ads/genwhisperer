export interface CuratedModel {
  id: string;        // OpenRouter model ID
  label: string;     // human-friendly name
  tier: "value" | "balanced" | "premium";
  note: string;      // short description shown in the dropdown
}

// Curated for GenWhisperer's purpose: strong instruction-following chat models,
// cheap -> premium. Edit this list to change what appears in the dropdowns.
export const CURATED_MODELS: CuratedModel[] = [
  { id: "deepseek/deepseek-v4-pro",            label: "DeepSeek V4 Pro",        tier: "value",    note: "Best value — fast and cheap (recommended default)" },
  { id: "openai/gpt-5.4-mini",                 label: "GPT-5.4 Mini",           tier: "value",    note: "Low-cost, reliable instruction following" },
  { id: "google/gemini-2.5-flash",             label: "Gemini 2.5 Flash",       tier: "value",    note: "Fast and inexpensive" },
  { id: "meta-llama/llama-3.3-70b-instruct",   label: "Llama 3.3 70B",          tier: "balanced", note: "Solid open model, mid-range cost" },
  { id: "openai/gpt-5.4",                      label: "GPT-5.4",                tier: "balanced", note: "Strong general-purpose quality" },
  { id: "anthropic/claude-sonnet-4.6",         label: "Claude Sonnet 4.6",      tier: "balanced", note: "Excellent at structured, precise output" },
  { id: "anthropic/claude-opus-4-8",           label: "Claude Opus 4.8",        tier: "premium",  note: "Highest quality — higher cost" },
  { id: "openai/gpt-5.4-pro",                  label: "GPT-5.4 Pro",            tier: "premium",  note: "Top-tier reasoning — higher cost" },
];

// Given the live model IDs returned by GET /api/chat/models, return only the
// curated models that are actually available right now, preserving curated order.
export function availableCuratedModels(liveIds: string[]): CuratedModel[] {
  const live = new Set(liveIds);
  const filtered = CURATED_MODELS.filter((m) => live.has(m.id));
  // If the live list couldn't be loaded or overlaps none, fall back to the full curated list
  return filtered.length > 0 ? filtered : CURATED_MODELS;
}
