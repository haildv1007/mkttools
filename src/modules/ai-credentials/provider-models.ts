/**
 * Recommended model catalog. This is BYOK (bring your own key): the customer
 * pays the provider directly, so this table is a set of recommended
 * defaults/labels/fallbacks — NOT a strict allowlist. A customer may type in
 * any model id their key supports; `providerSupportsModel` below is used for
 * UI labeling only and must never block saving an operation setting or
 * credential default.
 *
 * `providerSupports(provider, operation)` IS still an enforced check: it
 * reflects which operations this codebase has an actual provider
 * integration for (e.g. Claude has no image provider wired up).
 */

export type Operation = 'TEXT_GENERATION' | 'TEXT_REVISION' | 'IMAGE_GENERATION' | 'IMAGE_REVISION' | 'VIDEO_GENERATION';
export type Quality = 'FAST' | 'BALANCED' | 'QUALITY';

interface ModelTable {
  // operation -> quality -> model id
  [op: string]: Partial<Record<Quality, string>>;
}

/**
 * Table of supported (provider, operation, quality) -> model id.
 * Text models track known Anthropic/OpenAI/Google chat models; image
 * models track the ones the providers/*-image.ts files can consume.
 */
export const PROVIDER_MODELS: Record<string, ModelTable> = {
  claude: {
    TEXT_GENERATION: { FAST: 'claude-haiku-4-5-20251001', BALANCED: 'claude-sonnet-5-5', QUALITY: 'claude-opus-5-5' },
    TEXT_REVISION:   { FAST: 'claude-haiku-4-5-20251001', BALANCED: 'claude-sonnet-5-5', QUALITY: 'claude-opus-5-5' },
  },
  openai: {
    TEXT_GENERATION: { FAST: 'gpt-5-mini', BALANCED: 'gpt-5', QUALITY: 'gpt-5' },
    TEXT_REVISION:   { FAST: 'gpt-5-mini', BALANCED: 'gpt-5', QUALITY: 'gpt-5' },
    IMAGE_GENERATION: { FAST: 'gpt-image-2.5-flare', BALANCED: 'gpt-image-2.5-flare', QUALITY: 'gpt-image-2.5-sunburst' },
    IMAGE_REVISION:   { FAST: 'gpt-image-2.5-flare', BALANCED: 'gpt-image-2.5-flare', QUALITY: 'gpt-image-2.5-sunburst' },
  },
  gemini: {
    TEXT_GENERATION: { FAST: 'gemini-2.0-flash', BALANCED: 'gemini-2.5-flash', QUALITY: 'gemini-2.5-flash' },
    TEXT_REVISION:   { FAST: 'gemini-2.0-flash', BALANCED: 'gemini-2.5-flash', QUALITY: 'gemini-2.5-flash' },
    IMAGE_GENERATION: { FAST: 'gemini-3.1-flash-image', BALANCED: 'gemini-3.1-flash-image', QUALITY: 'gemini-3.1-pro-image' },
    IMAGE_REVISION:   { FAST: 'gemini-3.1-flash-image', BALANCED: 'gemini-3.1-flash-image', QUALITY: 'gemini-3.1-pro-image' },
  },
};

export const QUALITY_TIERS: Quality[] = ['FAST', 'BALANCED', 'QUALITY'];

export function providerSupports(provider: string, operation: Operation): boolean {
  return !!PROVIDER_MODELS[provider.toLowerCase()]?.[operation];
}

export function providerSupportsModel(provider: string, modelId: string): boolean {
  const table = PROVIDER_MODELS[provider.toLowerCase()];
  if (!table) return false;
  for (const op of Object.keys(table)) {
    for (const q of QUALITY_TIERS) {
      if (table[op]![q] === modelId) return true;
    }
  }
  return false;
}

export class AiModelNotSupportedError extends Error {
  status = 400 as const;
  code = 'AI_MODEL_NOT_SUPPORTED' as const;
  constructor(msg = 'Model không được provider hỗ trợ.') { super(msg); }
}
