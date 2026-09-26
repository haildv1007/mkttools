import { ContentType } from '@prisma/client';

export interface ExcelRow {
  date: string;
  time: string;
  rawDate?: unknown;
  rawTime?: unknown;
  page: string;
  topic: string;
  contentType: ContentType;
  notes?: string;
  imageDescriptions?: string;
}

export interface GeneratedContent {
  text: string;
  hashtags: string[];
  cta?: string;
}

export interface GeneratedImage {
  url: string;
  localPath?: string;
}

export interface TextGeneratorOptions {
  topic: string;
  pageName: string;
  contentType: ContentType;
  notes?: string;
  tone?: string;
  language?: string;
  previousFeedback?: string;
}

export interface ImageGeneratorOptions {
  prompt: string;
  style?: string;
  width?: number;
  height?: number;
}

export interface TextProvider {
  name: string;
  generate(options: TextGeneratorOptions): Promise<GeneratedContent>;
}

export interface ImageProvider {
  name: string;
  generate(options: ImageGeneratorOptions): Promise<GeneratedImage>;
}

export interface PublishResult {
  success: boolean;
  postId?: string;
  error?: string;
  url?: string;
}

export interface GeneratedVideo {
  url: string;
  localPath?: string;
  duration?: number;
}

export interface VideoGeneratorOptions {
  prompt: string;
  imageUrl?: string;
  duration?: number;
  aspectRatio?: string;
}

export interface VideoProvider {
  name: string;
  generate(options: VideoGeneratorOptions): Promise<GeneratedVideo>;
}

export interface TelegramApprovalPayload {
  contentItemId: string;
  pageInfo: string;
  scheduledAt: string;
  generatedText: string;
  imageUrl?: string;
}
