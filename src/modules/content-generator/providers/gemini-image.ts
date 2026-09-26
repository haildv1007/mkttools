import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../../../config';
import { getSetting } from '../../settings';
import type { ImageProvider, ImageGeneratorOptions, GeneratedImage } from '../../../types';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

export class GeminiImageProvider implements ImageProvider {
  name = 'gemini-imagen';

  async generate(options: ImageGeneratorOptions): Promise<GeneratedImage> {
    const apiKey = (await getSetting('GEMINI_API_KEY')) || config.ai.text.geminiApiKey;
    if (!apiKey) throw new Error('GEMINI_API_KEY chưa được cấu hình');

    const dbModel = await getSetting('AI_IMAGE_MODEL');
    const model = (dbModel && dbModel !== 'flux-schnell') ? dbModel : 'gemini-2.5-flash-preview-image';
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

    const appUrl = process.env.APP_URL || `http://localhost:${config.port}`;
    return { url: `${appUrl}/uploads/${filename}`, localPath: filePath };
  }
}
