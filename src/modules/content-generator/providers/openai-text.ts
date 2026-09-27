import OpenAI from 'openai';
import { config } from '../../../config';
import type { TextProvider, TextGeneratorOptions, GeneratedContent } from '../../../types';

export class OpenAITextProvider implements TextProvider {
  name = 'openai';
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: config.ai.text.openaiApiKey });
  }

  async generate(options: TextGeneratorOptions): Promise<GeneratedContent> {
    const response = await this.client.chat.completions.create({
      model: config.ai.text.defaultModel.startsWith('gpt') ? config.ai.text.defaultModel : 'gpt-5-mini',
      messages: [
        {
          role: 'system',
          content: `Bạn là chuyên gia content marketing mạng xã hội tại Việt Nam.
Viết content hấp dẫn, tự nhiên, phù hợp với nền tảng mạng xã hội.
Luôn trả về JSON với format: {"text": "...", "hashtags": ["..."], "cta": "..."}
Chỉ trả về JSON, không thêm gì khác.`,
        },
        {
          role: 'user',
          content: this.buildPrompt(options),
        },
      ],
      max_tokens: 1024,
    });

    const raw = response.choices[0]?.message?.content || '';
    return this.parseResponse(raw);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      if (!config.ai.text.openaiApiKey) return { ok: false, error: 'OPENAI_API_KEY chưa được cấu hình' };
      await this.client.models.list();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  private buildPrompt(options: TextGeneratorOptions): string {
    let prompt = `Viết bài đăng mạng xã hội cho page "${options.pageName}".
Chủ đề: ${options.topic}
Loại content: ${options.contentType}`;

    if (options.notes) prompt += `\nGhi chú thêm: ${options.notes}`;
    if (options.tone) prompt += `\nTone giọng: ${options.tone}`;
    if (options.previousFeedback) {
      prompt += `\n\nFeedback từ lần trước (hãy sửa theo): ${options.previousFeedback}`;
    }

    return prompt;
  }

  private parseResponse(raw: string): GeneratedContent {
    try {
      const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      const parsed = JSON.parse(cleaned);
      return {
        text: parsed.text || raw,
        hashtags: parsed.hashtags || [],
        cta: parsed.cta,
      };
    } catch {
      return { text: raw, hashtags: [] };
    }
  }
}
