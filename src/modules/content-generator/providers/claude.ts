import Anthropic from '@anthropic-ai/sdk';
import { config } from '../../../config';
import type { TextProvider, TextGeneratorOptions, GeneratedContent } from '../../../types';

export class ClaudeTextProvider implements TextProvider {
  name = 'claude';
  private client: Anthropic;

  constructor() {
    this.client = new Anthropic({ apiKey: config.ai.text.anthropicApiKey });
  }

  async generate(options: TextGeneratorOptions): Promise<GeneratedContent> {
    const systemPrompt = `Bạn là chuyên gia content marketing mạng xã hội tại Việt Nam.
Viết content hấp dẫn, tự nhiên, phù hợp với nền tảng mạng xã hội.
Luôn trả về JSON với format: {"text": "...", "hashtags": ["..."], "cta": "..."}
Chỉ trả về JSON, không thêm gì khác.`;

    const userPrompt = this.buildPrompt(options);

    const response = await this.client.messages.create({
      model: config.ai.text.defaultModel,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return this.parseResponse(text);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      if (!config.ai.text.anthropicApiKey) return { ok: false, error: 'ANTHROPIC_API_KEY chưa được cấu hình' };
      await this.client.messages.count_tokens({ model: config.ai.text.defaultModel || 'claude-sonnet-4-20250514', messages: [{ role: 'user', content: 'test' }] });
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
    if (options.language) prompt += `\nNgôn ngữ: ${options.language}`;
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
