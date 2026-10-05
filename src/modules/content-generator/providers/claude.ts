import Anthropic from '@anthropic-ai/sdk';
import type { TextProvider, TextGeneratorOptions, GeneratedContent } from '../../../types';

export class ClaudeTextProvider implements TextProvider {
  name = 'claude';

  async generate(options: TextGeneratorOptions): Promise<GeneratedContent> {
    const apiKey = options.credential?.apiKey;
    if (!apiKey) throw new Error('AI_PROVIDER_NOT_CONFIGURED');
    const client = new Anthropic({ apiKey });

    const systemPrompt = `Bạn là chuyên gia content marketing mạng xã hội tại Việt Nam.
Viết content hấp dẫn, tự nhiên, phù hợp với nền tảng mạng xã hội.
Luôn trả về JSON với format: {"text": "...", "hashtags": ["..."], "cta": "..."}
Chỉ trả về JSON, không thêm gì khác.`;

    const userPrompt = this.buildPrompt(options);

    // resolveGeneration() always resolves a concrete model before this
    // provider is called - use it exactly as selected, never substitute.
    const requestedModel = options.credential?.model;
    if (!requestedModel) throw new Error('AI_MODEL_NOT_AVAILABLE');
    const response = await client.messages.create({
      model: requestedModel,
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const text = response.content[0].type === 'text' ? response.content[0].text : '';
    return this.parseResponse(text);
  }

  async testConnection(cred?: { apiKey: string }): Promise<{ ok: boolean; error?: string }> {
    try {
      if (!cred?.apiKey) return { ok: false, error: 'Chưa có API key' };
      const client = new Anthropic({ apiKey: cred.apiKey });
      await client.messages.countTokens({ model: 'claude-haiku-4-5-20251001', messages: [{ role: 'user', content: 'test' }] });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  private buildPrompt(options: TextGeneratorOptions): string {
    let prompt = `Viết bài đăng mạng xã hội cho page "${options.pageName}".
Chủ đề: ${options.topic}
Loại content: ${options.contentType}`;

    if (options.pageContext) prompt += `\nThông tin về page (ADN thương hiệu): ${options.pageContext}`;
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
