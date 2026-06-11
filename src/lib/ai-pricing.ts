const TOKENS_PER_MILLION = 1_000_000;

// USD per 1M tokens. Keys are matched by longest prefix so dated snapshots
// like "gpt-4o-mini-2024-07-18" resolve to their base model pricing.
export const AI_MODEL_PRICING_USD_PER_1M_TOKENS = {
  "gpt-4o-mini": {
    input: 0.15,
    output: 0.6,
  },
  "gpt-4o": {
    input: 2.5,
    output: 10,
  },
  "gpt-4.1-nano": {
    input: 0.1,
    output: 0.4,
  },
  "gpt-4.1-mini": {
    input: 0.4,
    output: 1.6,
  },
  "gpt-4.1": {
    input: 2,
    output: 8,
  },
  "gpt-5-nano": {
    input: 0.05,
    output: 0.4,
  },
  "gpt-5-mini": {
    input: 0.25,
    output: 2,
  },
  "gpt-5": {
    input: 1.25,
    output: 10,
  },
} as const;

// Conservative fallback for models missing from the table, so the AI cap
// still meters spend instead of silently counting zero.
const FALLBACK_PRICING = { input: 2.5, output: 10 };

function resolvePricing(model: string) {
  const normalized = model.trim().toLowerCase();
  let bestMatch: { input: number; output: number } | null = null;
  let bestLength = 0;

  for (const [prefix, pricing] of Object.entries(
    AI_MODEL_PRICING_USD_PER_1M_TOKENS
  )) {
    if (normalized.startsWith(prefix) && prefix.length > bestLength) {
      bestMatch = pricing;
      bestLength = prefix.length;
    }
  }

  return bestMatch;
}

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  let pricing = resolvePricing(model);

  if (!pricing) {
    console.warn(
      `[ai-pricing] Unknown model pricing for ${model}. Using conservative fallback rates.`
    );
    pricing = FALLBACK_PRICING;
  }

  return (
    (Math.max(0, inputTokens) / TOKENS_PER_MILLION) * pricing.input +
    (Math.max(0, outputTokens) / TOKENS_PER_MILLION) * pricing.output
  );
}
