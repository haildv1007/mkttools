import type { TextProvider, ImageProvider, TextGeneratorOptions, ImageGeneratorOptions, GeneratedContent, GeneratedImage, CredentialContext } from '../../types';
import { ClaudeTextProvider } from './providers/claude';
import { OpenAITextProvider } from './providers/openai-text';
import { GeminiTextProvider } from './providers/gemini-text';
import { DalleImageProvider } from './providers/dalle-image';
import { GeminiImageProvider } from './providers/gemini-image';
import { tryResolveCredential, resolveGeneration } from '../ai-credentials';
import type { Operation } from '../ai-credentials';

const textProviders: Record<string, () => TextProvider> = {
  claude: () => new ClaudeTextProvider(),
  openai: () => new OpenAITextProvider(),
  gemini: () => new GeminiTextProvider(),
};

// Keyed by OrganizationAiCredential.provider ('openai' / 'gemini'), not by
// the provider class's internal display name (DalleImageProvider.name is
// still 'dalle' — that's cosmetic only).
const imageProviders: Record<string, () => ImageProvider> = {
  openai: () => new DalleImageProvider(),
  gemini: () => new GeminiImageProvider(),
};

// Providers are now stateless factories; there is no cached "active provider"
// because credentials + operation settings are per-organization and resolved
// at call time via resolveGeneration().

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

export function listProviders() {
  return { text: Object.keys(textProviders), image: Object.keys(imageProviders) };
}

/** No-ops kept only so the deprecated legacy settings routes still resolve.
 *  Provider selection is organization+operation scoped now (see
 *  resolveGeneration) — there is no global "active provider" to set. */
export function setTextProvider(_name: string): void {}
export function setImageProvider(_name: string): void {}

async function attachCredential(
  opts: { credential?: CredentialContext } | undefined,
  operation: Operation,
): Promise<CredentialContext> {
  const ctx: CredentialContext = { ...(opts?.credential ?? { organizationId: '' }) };
  if (!ctx.organizationId) {
    throw new Error('AI_PROVIDER_NOT_CONFIGURED: missing organizationId');
  }
  const resolved = await resolveGeneration({
    organizationId: ctx.organizationId,
    operation: ctx.operation || operation,
    explicitProvider: ctx.provider ?? null,
    explicitModel: ctx.model ?? null,
    actorUserId: ctx.actorUserId,
  });
  ctx.provider = resolved.provider;
  ctx.model = resolved.model;
  ctx.apiKey = resolved.apiKey;
  ctx.operation = resolved.operation;
  return ctx;
}

export async function generateText(options: TextGeneratorOptions): Promise<GeneratedContent> {
  const op: Operation = options.credential?.operation || (options.previousFeedback ? 'TEXT_REVISION' : 'TEXT_GENERATION');
  const credential = await attachCredential(options, op);
  const provider = await makeTextProvider(credential.provider!);
  return provider.generate({ ...options, credential });
}

export async function generateImage(options: ImageGeneratorOptions): Promise<GeneratedImage> {
  const op: Operation = options.credential?.operation || 'IMAGE_GENERATION';
  const credential = await attachCredential(options, op);
  const provider = await makeImageProvider(credential.provider!);
  return provider.generate({ ...options, credential });
}

export function registerTextProvider(name: string, factory: () => TextProvider): void {
  textProviders[name] = factory;
}
export function registerImageProvider(name: string, factory: () => ImageProvider): void {
  imageProviders[name] = factory;
}

/**
 * Test connectivity for whichever provider the organization has configured
 * for TEXT_GENERATION / IMAGE_GENERATION — reads the same operation setting
 * generation itself uses, so "Test" reflects what will actually run.
 */
export async function testConnection(type: 'text' | 'image', organizationId?: string): Promise<{ ok: boolean; error?: string }> {
  try {
    if (!organizationId) return { ok: false, error: 'Cần Organization context' };
    const op: Operation = type === 'text' ? 'TEXT_GENERATION' : 'IMAGE_GENERATION';
    const resolved = await resolveGeneration({ organizationId, operation: op });
    const cred = await tryResolveCredential({ organizationId, provider: resolved.provider });
    if (!cred) return { ok: false, error: `Chưa cấu hình API ${resolved.provider}` };
    const provider: { testConnection?(cred: { apiKey: string }): Promise<{ ok: boolean; error?: string }> } =
      type === 'text' ? await makeTextProvider(resolved.provider) : await makeImageProvider(resolved.provider);
    if (!provider.testConnection) return { ok: true };
    return await provider.testConnection({ apiKey: cred.apiKey });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
