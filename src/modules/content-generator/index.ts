import { config } from '../../config';
import { getSetting } from '../settings';
import type { TextProvider, ImageProvider, VideoProvider, TextGeneratorOptions, ImageGeneratorOptions, VideoGeneratorOptions, GeneratedContent, GeneratedImage, GeneratedVideo } from '../../types';
import { ClaudeTextProvider } from './providers/claude';
import { OpenAITextProvider } from './providers/openai-text';
import { GeminiTextProvider } from './providers/gemini-text';
import { ReplicateImageProvider } from './providers/replicate-image';
import { DalleImageProvider } from './providers/dalle-image';
import { GeminiImageProvider } from './providers/gemini-image';
import { KlingVideoProvider } from './providers/kling-video';
import { MinimaxVideoProvider } from './providers/minimax-video';
import { RunwayVideoProvider } from './providers/runway-video';
import { VeoVideoProvider } from './providers/veo-video';
import { SeedanceVideoProvider } from './providers/seedance-video';

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

const videoProviders: Record<string, () => VideoProvider> = {
  veo: () => new VeoVideoProvider(),
  kling: () => new KlingVideoProvider(),
  minimax: () => new MinimaxVideoProvider(),
  runway: () => new RunwayVideoProvider(),
  seedance: () => new SeedanceVideoProvider(),
};

let activeTextProvider: TextProvider | null = null;
let activeTextProviderName: string | null = null;
let activeImageProvider: ImageProvider | null = null;
let activeImageProviderName: string | null = null;
let activeVideoProvider: VideoProvider | null = null;
let activeVideoProviderName: string | null = null;

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

async function getVideoProvider(): Promise<VideoProvider> {
  const dbProvider = await getSetting('AI_VIDEO_PROVIDER');
  const providerName = dbProvider || 'kling';
  if (!activeVideoProvider || activeVideoProviderName !== providerName) {
    const factory = videoProviders[providerName];
    if (!factory) throw new Error(`Unknown video provider: ${providerName}`);
    activeVideoProvider = factory();
    activeVideoProviderName = providerName;
  }
  return activeVideoProvider;
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

export function setVideoProvider(name: string): void {
  const factory = videoProviders[name];
  if (!factory) throw new Error(`Unknown video provider: ${name}. Available: ${Object.keys(videoProviders).join(', ')}`);
  activeVideoProvider = factory();
  activeVideoProviderName = name;
}

export async function listProviders() {
  let activeVideo = 'kling';
  try { activeVideo = (await getVideoProvider()).name; } catch { /* no video provider configured */ }
  return {
    text: Object.keys(textProviders),
    image: Object.keys(imageProviders),
    video: Object.keys(videoProviders),
    activeText: (await getTextProvider()).name,
    activeImage: (await getImageProvider()).name,
    activeVideo,
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

export async function generateVideo(options: VideoGeneratorOptions): Promise<GeneratedVideo> {
  return (await getVideoProvider()).generate(options);
}

export function registerVideoProvider(name: string, factory: () => VideoProvider): void {
  videoProviders[name] = factory;
}
