import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../../../config';
import { getSetting } from '../../settings';
import type { VideoProvider, VideoGeneratorOptions, GeneratedVideo } from '../../../types';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

export class VeoVideoProvider implements VideoProvider {
  name = 'veo';

  async generate(options: VideoGeneratorOptions): Promise<GeneratedVideo> {
    const apiKey = (await getSetting('GEMINI_API_KEY')) || process.env.GEMINI_API_KEY;
    if (!apiKey) throw new Error('GEMINI_API_KEY chưa được cấu hình');

    const model = (await getSetting('AI_VIDEO_MODEL')) || 'veo-3.1-generate-preview';
    const duration = options.duration || 8;

    const generateUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:predictLongRunning`;

    const body: Record<string, unknown> = {
      instances: [{
        prompt: options.prompt,
      }],
      parameters: {
        durationSeconds: duration,
        aspectRatio: options.aspectRatio || '16:9',
      },
    };

    if (options.imageUrl) {
      (body.instances as Array<Record<string, unknown>>)[0].image = {
        bytesBase64Encoded: await this.urlToBase64(options.imageUrl),
        mimeType: 'image/png',
      };
    }

    console.log(`[Veo] Generating video with model ${model}, duration ${duration}s`);
    const createRes = await fetch(generateUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json() as { name?: string; error?: { message: string; code?: number } };
    console.log('[Veo] Create response:', JSON.stringify(createData).substring(0, 500));

    if (createData.error || !createData.name) {
      throw new Error(`Veo API error: ${createData.error?.message || JSON.stringify(createData)}`);
    }

    const operationName = createData.name;
    const videoData = await this.pollForResult(apiKey, operationName);
    return this.saveVideo(videoData);
  }

  private async urlToBase64(url: string): Promise<string> {
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    return buffer.toString('base64');
  }

  private async pollForResult(apiKey: string, operationName: string, maxWait = 600000): Promise<Buffer> {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 15000));

      const pollUrl = `https://generativelanguage.googleapis.com/v1beta/${operationName}`;
      const res = await fetch(pollUrl, {
        headers: { 'x-goog-api-key': apiKey },
      });
      const data = await res.json() as {
        done?: boolean;
        response?: {
          generateVideoResponse?: {
            generatedSamples?: Array<{ video?: { uri?: string } }>;
          };
        };
        error?: { message: string };
      };

      console.log(`[Veo] Poll status: done=${data.done}`);

      if (data.error) {
        throw new Error(`Veo error: ${data.error.message}`);
      }

      if (data.done) {
        const samples = data.response?.generateVideoResponse?.generatedSamples;
        const videoUri = samples?.[0]?.video?.uri;
        if (!videoUri) throw new Error('Veo: no video in result');
        console.log(`[Veo] Video URI: ${videoUri}`);

        const videoRes = await fetch(videoUri, {
          headers: { 'x-goog-api-key': apiKey },
        });
        if (!videoRes.ok) {
          const errText = await videoRes.text().catch(() => '');
          console.log(`[Veo] Download error ${videoRes.status}: ${errText.substring(0, 300)}`);
          throw new Error(`Veo: failed to download video (${videoRes.status})`);
        }
        return Buffer.from(await videoRes.arrayBuffer());
      }
    }
    throw new Error('Veo: timeout waiting for video (10 min)');
  }

  private saveVideo(buffer: Buffer): GeneratedVideo {
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const filename = `vid-${crypto.randomUUID()}.mp4`;
    const filePath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    const appUrl = process.env.APP_URL || `http://localhost:${config.port}`;
    return { url: `${appUrl}/uploads/${filename}`, localPath: filePath };
  }
}
