import { config } from '../../../config';
import type { TextProvider, TextGeneratorOptions, GeneratedContent } from '../../../types';

export class GeminiTextProvider implements TextProvider {
  name = 'gemini';

  async generate(options: TextGeneratorOptions): Promise<GeneratedContent> {
    const systemPrompt = `Bạn là chuyên gia content marketing mạng xã hội tại Việt Nam.
Viết content hấp dẫn, tự nhiên, phù hợp với nền tảng mạng xã hội.
Luôn trả về JSON với format: {"text": "...", "hashtags": ["..."], "cta": "..."}
Chỉ trả về JSON, không thêm gì khác.`;

    const userPrompt = this.buildPrompt(options);

    const model = config.ai.text.defaultModel || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.ai.text.geminiApiKey}`;

    console.log('[Gemini Debug] model:', model, 'key:', config.ai.text.geminiApiKey?.substring(0, 15) + '...', 'url:', url.replace(config.ai.text.geminiApiKey, 'KEY_HIDDEN'));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: { maxOutputTokens: 1024 },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${err}`);
    }

    const data = await response.json();
    const parts = data.candidates?.[0]?.content?.parts || [];
    const textPart = parts.filter((p: { thought?: boolean }) => !p.thought).pop();
    const text = textPart?.text || parts[parts.length - 1]?.text || '';
    return this.parseResponse(text);
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
      let cleaned = raw.trim();
      const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (jsonMatch) {
        cleaned = jsonMatch[1].trim();
      }
      const parsed = JSON.parse(cleaned);
      return {
        text: parsed.text || raw,
        hashtags: (parsed.hashtags || []).map((h: string) => h.replace(/^#/, '')),
        cta: parsed.cta,
      };
    } catch {
      return { text: raw, hashtags: [] };
    }
  }
}
