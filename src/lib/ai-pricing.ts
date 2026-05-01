const TOKENS_PER_MILLION = 1_000_000;

export const AI_MODEL_PRICING_USD_PER_1M_TOKENS = {
  "gpt-4o-mini": {
    input: 0.15,
    output: 0.6,
  },
  "gpt-4o": {
    input: 2.5,
    output: 10,
  },
} as const;

export function calculateCost(
  model: string,
  inputTokens: number,
  outputTokens: number
): number {
  const pricing =
    AI_MODEL_PRICING_USD_PER_1M_TOKENS[
      model as keyof typeof AI_MODEL_PRICING_USD_PER_1M_TOKENS
    ];

  if (!pricing) {
    console.warn(`[ai-pricing] Unknown model pricing for ${model}.`);
    return 0;
  }

  return (
    (Math.max(0, inputTokens) / TOKENS_PER_MILLION) * pricing.input +
    (Math.max(0, outputTokens) / TOKENS_PER_MILLION) * pricing.output
  );
}
