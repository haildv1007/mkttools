import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ImageProvider, ImageGeneratorOptions, GeneratedImage } from '../../../types';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

export class GeminiImageProvider implements ImageProvider {
  name = 'gemini-imagen';

  async testConnection(cred?: { apiKey: string }): Promise<{ ok: boolean; error?: string }> {
    try {
      const apiKey = cred?.apiKey;
      if (!apiKey) return { ok: false, error: 'Chưa có API key' };
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${apiKey}`);
      if (!res.ok) return { ok: false, error: `Gemini API lỗi: ${res.status}` };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  async generate(options: ImageGeneratorOptions): Promise<GeneratedImage> {
    const apiKey = options.credential?.apiKey;
    if (!apiKey) throw new Error('AI_PROVIDER_NOT_CONFIGURED');

    // resolveGeneration() always resolves a concrete model before this
    // provider is called — use it exactly as selected, never substitute.
    const model = options.credential?.model;
    if (!model) throw new Error('AI_MODEL_NOT_AVAILABLE');
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{ text: `Generate an image: ${options.prompt}` }],
        }],
        generationConfig: {
          responseModalities: ['TEXT', 'IMAGE'],
        },
      }),
    });

    const data = await res.json() as {
      candidates?: Array<{
        content: {
          parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
        };
      }>;
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`Gemini Image: ${data.error.message}`);
    }

    const parts = data.candidates?.[0]?.content?.parts;
    const imagePart = parts?.find(p => p.inlineData);

    if (!imagePart?.inlineData) {
      throw new Error('Gemini returned no image');
    }

    const buffer = Buffer.from(imagePart.inlineData.data, 'base64');
    const ext = imagePart.inlineData.mimeType.includes('png') ? 'png' : 'jpg';

    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const filename = `img-${crypto.randomUUID()}.${ext}`;
    const filePath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filePath, buffer);

    return { url: `/uploads/${filename}`, localPath: filePath };
  }
}
