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
  generatedText?: string;
  imageUrl?: string;
  videoUrl?: string;
  source?: string;
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
  testConnection?(): Promise<{ ok: boolean; error?: string }>;
}

export interface ImageProvider {
  name: string;
  generate(options: ImageGeneratorOptions): Promise<GeneratedImage>;
  testConnection?(): Promise<{ ok: boolean; error?: string }>;
}

export interface PublishResult {
  success: boolean;
  postId?: string;
  error?: string;
  url?: string;
}


export interface TelegramApprovalPayload {
  contentItemId: string;
  pageInfo: string;
  scheduledAt: string;
  generatedText: string;
  imageUrl?: string;
}
