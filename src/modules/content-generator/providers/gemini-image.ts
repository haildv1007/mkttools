import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../../../config';
import type { ImageProvider, ImageGeneratorOptions, GeneratedImage } from '../../../types';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

export class GeminiImageProvider implements ImageProvider {
  name = 'gemini-imagen';

  async generate(options: ImageGeneratorOptions): Promise<GeneratedImage> {
    const apiKey = config.ai.text.geminiApiKey;
    if (!apiKey) throw new Error('GEMINI_API_KEY chưa được cấu hình');

    const model = 'imagen-3.0-generate-002';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predict?key=${apiKey}`;

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instances: [{ prompt: options.prompt }],
        parameters: {
          sampleCount: 1,
          aspectRatio: '1:1',
        },
      }),
    });

    const data = await res.json() as {
      predictions?: Array<{ bytesBase64Encoded: string; mimeType: string }>;
      error?: { message: string };
    };

    if (data.error) {
      throw new Error(`Gemini Imagen: ${data.error.message}`);
    }

    if (!data.predictions?.[0]?.bytesBase64Encoded) {
      throw new Error('Gemini Imagen returned no image');
    }

    const base64 = data.predictions[0].bytesBase64Encoded;
    const buffer = Buffer.from(base64, 'base64');

    // Save to public/uploads so it's accessible via HTTP
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const filename = `img-${crypto.randomUUID()}.png`;
    const filePath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filePath, buffer);

    const appUrl = process.env.APP_URL || `http://localhost:${config.port}`;
    return { url: `${appUrl}/uploads/${filename}`, localPath: filePath };
  }
}
