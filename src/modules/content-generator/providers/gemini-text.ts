import { config } from '../../../config';
import type { TextProvider, TextGeneratorOptions, GeneratedContent } from '../../../types';

export class GeminiTextProvider implements TextProvider {
  name = 'gemini';

  async generate(options: TextGeneratorOptions): Promise<GeneratedContent> {
    const systemPrompt = `Bạn là chuyên gia content marketing mạng xã hội tại Việt Nam.
Viết content hấp dẫn, tự nhiên, phù hợp với nền tảng mạng xã hội.
Trả về JSON với format: {"text": "nội dung bài đăng", "hashtags": ["tag1", "tag2"], "cta": "câu kêu gọi hành động"}`;

    const userPrompt = this.buildPrompt(options);

    const model = config.ai.text.defaultModel || 'gemini-2.0-flash';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.ai.text.geminiApiKey}`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: systemPrompt }] },
        contents: [{ parts: [{ text: userPrompt }] }],
        generationConfig: {
          maxOutputTokens: 4096,
          responseMimeType: 'application/json',
        },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Gemini API error: ${response.status} ${err}`);
    }

    const data = await response.json() as { candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] } }[] };
    const parts = data.candidates?.[0]?.content?.parts || [];
    const textPart = parts.filter((p: { thought?: boolean }) => !p.thought).pop();
    const raw = textPart?.text || parts[parts.length - 1]?.text || '';
    return this.parseResponse(raw);
  }

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const apiKey = config.ai.text.geminiApiKey;
      if (!apiKey) return { ok: false, error: 'GEMINI_API_KEY chưa được cấu hình' };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (!res.ok) return { ok: false, error: `Gemini API lỗi: ${res.status}` };
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
      let cleaned = raw.trim();
      const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
      if (jsonMatch) cleaned = jsonMatch[1].trim();
      const parsed = JSON.parse(cleaned);
      return {
        text: parsed.text || raw,
        hashtags: (parsed.hashtags || []).map((h: string) => String(h).replace(/^#/, '')),
        cta: parsed.cta,
      };
    } catch {
      return { text: raw, hashtags: [] };
    }
  }
}
