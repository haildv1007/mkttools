import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import OpenAI from 'openai';
import type { ImageProvider, ImageGeneratorOptions, GeneratedImage } from '../../../types';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

export class DalleImageProvider implements ImageProvider {
  name = 'dalle';

  async testConnection(cred?: { apiKey: string }): Promise<{ ok: boolean; error?: string }> {
    try {
      const apiKey = cred?.apiKey;
      if (!apiKey) return { ok: false, error: 'Chưa có API key' };
      const client = new OpenAI({ apiKey });
      await client.models.list();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  async generate(options: ImageGeneratorOptions): Promise<GeneratedImage> {
    const apiKey = options.credential?.apiKey;
    if (!apiKey) throw new Error('AI_PROVIDER_NOT_CONFIGURED');

    const client = new OpenAI({ apiKey });
    // resolveGeneration() always resolves a concrete model before this
    // provider is called - use it exactly as selected, never substitute.
    const model = options.credential?.model;
    if (!model) throw new Error('AI_MODEL_NOT_AVAILABLE');

    const isGptImage = model.startsWith('gpt-image');
    const genParams: Record<string, unknown> = {
      model,
      prompt: options.prompt,
      size: '1024x1024',
      n: 1,
    };
    if (isGptImage) {
      genParams.quality = 'low';
    } else {
      genParams.quality = 'standard';
      genParams.response_format = 'b64_json';
    }

    const response = await client.images.generate(genParams as unknown as Parameters<typeof client.images.generate>[0]);

    const b64 = response.data?.[0]?.b64_json;
    const url = response.data?.[0]?.url;

    if (b64) {
      const buffer = Buffer.from(b64, 'base64');
      if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const filename = `img-${crypto.randomUUID()}.png`;
      const filePath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(filePath, buffer);
      return { url: `/uploads/${filename}`, localPath: filePath };
    }

    if (url) {
      const res = await fetch(url);
      const arrayBuf = await res.arrayBuffer();
      const buffer = Buffer.from(arrayBuf);
      if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
      const filename = `img-${crypto.randomUUID()}.png`;
      const filePath = path.join(UPLOAD_DIR, filename);
      fs.writeFileSync(filePath, buffer);
      return { url: `/uploads/${filename}`, localPath: filePath };
    }

    throw new Error('OpenAI returned no image');
  }
}
