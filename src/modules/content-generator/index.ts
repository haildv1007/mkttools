import { config } from '../../config';
import type { TextProvider, ImageProvider, TextGeneratorOptions, ImageGeneratorOptions, GeneratedContent, GeneratedImage } from '../../types';
import { ClaudeTextProvider } from './providers/claude';
import { OpenAITextProvider } from './providers/openai-text';
import { GeminiTextProvider } from './providers/gemini-text';
import { ReplicateImageProvider } from './providers/replicate-image';
import { DalleImageProvider } from './providers/dalle-image';

const textProviders: Record<string, () => TextProvider> = {
  claude: () => new ClaudeTextProvider(),
  openai: () => new OpenAITextProvider(),
  gemini: () => new GeminiTextProvider(),
};

const imageProviders: Record<string, () => ImageProvider> = {
  replicate: () => new ReplicateImageProvider(),
  dalle: () => new DalleImageProvider(),
};

let activeTextProvider: TextProvider | null = null;
let activeImageProvider: ImageProvider | null = null;

function getTextProvider(): TextProvider {
  if (!activeTextProvider) {
    const factory = textProviders[config.ai.text.provider];
    if (!factory) throw new Error(`Unknown text provider: ${config.ai.text.provider}`);
    activeTextProvider = factory();
  }
  return activeTextProvider;
}

function getImageProvider(): ImageProvider {
  if (!activeImageProvider) {
    const factory = imageProviders[config.ai.image.provider];
    if (!factory) throw new Error(`Unknown image provider: ${config.ai.image.provider}`);
    activeImageProvider = factory();
  }
  return activeImageProvider;
}

export function setTextProvider(name: string): void {
  const factory = textProviders[name];
  if (!factory) throw new Error(`Unknown text provider: ${name}. Available: ${Object.keys(textProviders).join(', ')}`);
  activeTextProvider = factory();
}

export function setImageProvider(name: string): void {
  const factory = imageProviders[name];
  if (!factory) throw new Error(`Unknown image provider: ${name}. Available: ${Object.keys(imageProviders).join(', ')}`);
  activeImageProvider = factory();
}

export function listProviders() {
  return {
    text: Object.keys(textProviders),
    image: Object.keys(imageProviders),
    activeText: getTextProvider().name,
    activeImage: getImageProvider().name,
  };
}

export async function generateText(options: TextGeneratorOptions): Promise<GeneratedContent> {
  return getTextProvider().generate(options);
}

export async function generateImage(options: ImageGeneratorOptions): Promise<GeneratedImage> {
  return getImageProvider().generate(options);
}

export function registerTextProvider(name: string, factory: () => TextProvider): void {
  textProviders[name] = factory;
}

export function registerImageProvider(name: string, factory: () => ImageProvider): void {
  imageProviders[name] = factory;
}
