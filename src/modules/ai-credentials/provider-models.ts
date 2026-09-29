/**
 * Recommended model catalog. This is BYOK (bring your own key): the customer
 * pays the provider directly and explicitly picks their model — this table
 * is recommended options/labels for the UI, NOT a strict allowlist and NOT
 * a tier-based resolver. A customer may type in any model id their key
 * supports (see the "Nhập Model ID khác" manual input in Settings).
 *
 * `providerSupports(provider, operation)` IS still an enforced check: it
 * reflects which operations this codebase has an actual provider
 * integration for (e.g. Claude has no image provider wired up).
 */

export type Operation = 'TEXT_GENERATION' | 'TEXT_REVISION' | 'IMAGE_GENERATION' | 'IMAGE_REVISION' | 'VIDEO_GENERATION';

/** operation -> recommended model ids, most-recommended first. No tiers. */
type OperationModels = Partial<Record<Operation, string[]>>;

export const PROVIDER_MODELS: Record<string, OperationModels> = {
  claude: {
    TEXT_GENERATION: ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    TEXT_REVISION: ['claude-haiku-4-5-20251001', 'claude-sonnet-5-5', 'claude-opus-5-5'],
  },
  openai: {
    TEXT_GENERATION: ['gpt-5-mini', 'gpt-5'],
    TEXT_REVISION: ['gpt-5-mini', 'gpt-5'],
    IMAGE_GENERATION: ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'],
    IMAGE_REVISION: ['gpt-image-2.5-flare', 'gpt-image-2.5-sunburst'],
  },
  gemini: {
    TEXT_GENERATION: ['gemini-2.0-flash', 'gemini-2.5-flash'],
    TEXT_REVISION: ['gemini-2.0-flash', 'gemini-2.5-flash'],
    IMAGE_GENERATION: ['gemini-3.1-flash-image', 'gemini-3.1-pro-image'],
    IMAGE_REVISION: ['gemini-3.1-flash-image', 'gemini-3.1-pro-image'],
  },
};

export function providerSupports(provider: string, operation: Operation): boolean {
  return !!PROVIDER_MODELS[provider.toLowerCase()]?.[operation]?.length;
}

export function recommendedModels(provider: string, operation: Operation): string[] {
  return PROVIDER_MODELS[provider.toLowerCase()]?.[operation] || [];
}
