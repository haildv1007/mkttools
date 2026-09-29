import { config } from '../../config';
import { getSetting } from '../settings';
import type { TextProvider, ImageProvider, TextGeneratorOptions, ImageGeneratorOptions, GeneratedContent, GeneratedImage, CredentialContext } from '../../types';
import { ClaudeTextProvider } from './providers/claude';
import { OpenAITextProvider } from './providers/openai-text';
import { GeminiTextProvider } from './providers/gemini-text';
import { DalleImageProvider } from './providers/dalle-image';
import { GeminiImageProvider } from './providers/gemini-image';
import { resolveCredential, tryResolveCredential, AiProviderNotConfiguredError, resolveModel } from '../ai-credentials';
import type { Operation } from '../ai-credentials';

const textProviders: Record<string, () => TextProvider> = {
  claude: () => new ClaudeTextProvider(),
  openai: () => new OpenAITextProvider(),
  gemini: () => new GeminiTextProvider(),
};

const imageProviders: Record<string, () => ImageProvider> = {
  dalle: () => new DalleImageProvider(),
  gemini: () => new GeminiImageProvider(),
};

// Providers are now stateless factories; there is no cached "active provider"
// because credentials are per-organization and resolved at call time.

async function getTextProviderName(): Promise<string> {
  return (await getSetting('AI_TEXT_PROVIDER')) || config.ai.text.provider;
}
async function getImageProviderName(): Promise<string> {
  return (await getSetting('AI_IMAGE_PROVIDER')) || config.ai.image.provider;
}
async function getTextModelName(): Promise<string | null> {
  return (await getSetting('AI_TEXT_MODEL')) || config.ai.text.defaultModel || null;
}
async function getImageModelName(): Promise<string | null> {
  return (await getSetting('AI_IMAGE_MODEL')) || config.ai.image.defaultModel || null;
}

async function makeTextProvider(name: string): Promise<TextProvider> {
  const f = textProviders[name];
  if (!f) throw new Error(`Unknown text provider: ${name}`);
  return f();
}
async function makeImageProvider(name: string): Promise<ImageProvider> {
  const f = imageProviders[name];
  if (!f) throw new Error(`Unknown image provider: ${name}`);
  return f();
}

/** No-op setters kept for backwards-compatible callers. */
export function setTextProvider(_name: string): void { /* stateless now */ }
export function setImageProvider(_name: string): void { /* stateless now */ }

export async function listProviders() {
  return {
    text: Object.keys(textProviders),
    image: Object.keys(imageProviders),
    activeText: await getTextProviderName(),
    activeImage: await getImageProviderName(),
  };
}

async function attachCredential(
  opts: { credential?: CredentialContext } | undefined,
  providerName: string,
  operation: Operation,
): Promise<CredentialContext> {
  const ctx: CredentialContext = { ...(opts?.credential ?? { organizationId: '' }) };
  if (!ctx.organizationId) {
    throw new AiProviderNotConfiguredError(providerName);
  }
  ctx.provider = providerName;
  ctx.operation = ctx.operation || operation;
  // Resolve credential (per org, encrypted) if not already injected.
  if (!ctx.apiKey) {
    const resolved = await resolveCredential({
      organizationId: ctx.organizationId,
      provider: providerName,
      actorUserId: ctx.actorUserId,
    });
    ctx.apiKey = resolved.apiKey;
  }
  // Resolve model via AiModelResolver: explicit ctx.model wins, otherwise
  // (org default quality) -> BALANCED -> first supported tier.
  const resolved = await resolveModel({
    organizationId: ctx.organizationId,
    provider: providerName,
    operation: ctx.operation!,
    qualityTier: ctx.qualityTier ?? null,
    explicitModel: ctx.model ?? null,
  });
  ctx.model = resolved.model;
  ctx.qualityTier = resolved.quality;
  return ctx;
}

export async function generateText(options: TextGeneratorOptions): Promise<GeneratedContent> {
  const providerName = options.credential?.provider || (await getTextProviderName());
  const op: Operation = options.credential?.operation || (options.previousFeedback ? 'TEXT_REVISION' : 'TEXT_GENERATION');
  const credential = await attachCredential(options, providerName, op);
  const provider = await makeTextProvider(providerName);
  return provider.generate({ ...options, credential });
}

export async function generateImage(options: ImageGeneratorOptions): Promise<GeneratedImage> {
  const providerName = options.credential?.provider || (await getImageProviderName());
  const op: Operation = options.credential?.operation || 'IMAGE_GENERATION';
  const credential = await attachCredential(options, providerName, op);
  const provider = await makeImageProvider(providerName);
  return provider.generate({ ...options, credential });
}

export function registerTextProvider(name: string, factory: () => TextProvider): void {
  textProviders[name] = factory;
}
export function registerImageProvider(name: string, factory: () => ImageProvider): void {
  imageProviders[name] = factory;
}

/**
 * Legacy admin "test connection" from the global settings page. It's fine
 * to keep this using the default text/image provider name — the resolver
 * still needs an organizationId, which the caller must supply.
 */
export async function testConnection(type: 'text' | 'image', organizationId?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    const name = type === 'text' ? await getTextProviderName() : await getImageProviderName();
    if (!organizationId) return { ok: false, error: 'Cần Organization context' };
    const cred = await tryResolveCredential({ organizationId, provider: name });
    if (!cred) return { ok: false, error: `Chưa cấu hình API ${name}` };
    const provider: { testConnection?(cred: { apiKey: string }): Promise<{ ok: boolean; error?: string }> } =
      type === 'text' ? await makeTextProvider(name) : await makeImageProvider(name);
    if (!provider.testConnection) return { ok: true };
    return await provider.testConnection({ apiKey: cred.apiKey });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
