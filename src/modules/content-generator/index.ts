import { config } from '../../config';
import { getSetting } from '../settings';
import type { TextProvider, ImageProvider, TextGeneratorOptions, ImageGeneratorOptions, GeneratedContent, GeneratedImage } from '../../types';
import { ClaudeTextProvider } from './providers/claude';
import { OpenAITextProvider } from './providers/openai-text';
import { GeminiTextProvider } from './providers/gemini-text';
import { ReplicateImageProvider } from './providers/replicate-image';
import { DalleImageProvider } from './providers/dalle-image';
import { GeminiImageProvider } from './providers/gemini-image';

const textProviders: Record<string, () => TextProvider> = {
  claude: () => new ClaudeTextProvider(),
  openai: () => new OpenAITextProvider(),
  gemini: () => new GeminiTextProvider(),
};

const imageProviders: Record<string, () => ImageProvider> = {
  replicate: () => new ReplicateImageProvider(),
  dalle: () => new DalleImageProvider(),
  gemini: () => new GeminiImageProvider(),
};

let activeTextProvider: TextProvider | null = null;
let activeTextProviderName: string | null = null;
let activeImageProvider: ImageProvider | null = null;
let activeImageProviderName: string | null = null;

async function getTextProvider(): Promise<TextProvider> {
  const dbProvider = await getSetting('AI_TEXT_PROVIDER');
  const providerName = dbProvider || config.ai.text.provider;
  if (!activeTextProvider || activeTextProviderName !== providerName) {
    const factory = textProviders[providerName];
    if (!factory) throw new Error(`Unknown text provider: ${providerName}`);
    activeTextProvider = factory();
    activeTextProviderName = providerName;
  }
  return activeTextProvider;
}

async function getImageProvider(): Promise<ImageProvider> {
  const dbProvider = await getSetting('AI_IMAGE_PROVIDER');
  const providerName = dbProvider || config.ai.image.provider;
  if (!activeImageProvider || activeImageProviderName !== providerName) {
    const factory = imageProviders[providerName];
    if (!factory) throw new Error(`Unknown image provider: ${providerName}`);
    activeImageProvider = factory();
    activeImageProviderName = providerName;
  }
  return activeImageProvider;
}

export function setTextProvider(name: string): void {
  const factory = textProviders[name];
  if (!factory) throw new Error(`Unknown text provider: ${name}. Available: ${Object.keys(textProviders).join(', ')}`);
  activeTextProvider = factory();
  activeTextProviderName = name;
}

export function setImageProvider(name: string): void {
  const factory = imageProviders[name];
  if (!factory) throw new Error(`Unknown image provider: ${name}. Available: ${Object.keys(imageProviders).join(', ')}`);
  activeImageProvider = factory();
  activeImageProviderName = name;
}

export async function listProviders() {
  return {
    text: Object.keys(textProviders),
    image: Object.keys(imageProviders),
    activeText: (await getTextProvider()).name,
    activeImage: (await getImageProvider()).name,
  };
}

export async function generateText(options: TextGeneratorOptions): Promise<GeneratedContent> {
  return (await getTextProvider()).generate(options);
}

export async function generateImage(options: ImageGeneratorOptions): Promise<GeneratedImage> {
  return (await getImageProvider()).generate(options);
}

export function registerTextProvider(name: string, factory: () => TextProvider): void {
  textProviders[name] = factory;
}

export function registerImageProvider(name: string, factory: () => ImageProvider): void {
  imageProviders[name] = factory;
}

export async function testConnection(type: 'text' | 'image'): Promise<{ ok: boolean; error?: string }> {
  try {
    let provider: { testConnection?(): Promise<{ ok: boolean; error?: string }> };
    if (type === 'text') provider = await getTextProvider();
    else provider = await getImageProvider();
    if (!provider.testConnection) return { ok: true };
    return await provider.testConnection();
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
  }
}
