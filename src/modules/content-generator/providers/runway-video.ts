import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../../../config';
import { getSetting } from '../../settings';
import type { VideoProvider, VideoGeneratorOptions, GeneratedVideo } from '../../../types';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const API_BASE = 'https://api.dev.runwayml.com/v1';

export class RunwayVideoProvider implements VideoProvider {
  name = 'runway';

  async generate(options: VideoGeneratorOptions): Promise<GeneratedVideo> {
    const apiKey = (await getSetting('RUNWAY_API_KEY')) || process.env.RUNWAY_API_KEY;
    if (!apiKey) throw new Error('RUNWAY_API_KEY chưa được cấu hình');

    const model = (await getSetting('AI_VIDEO_MODEL')) || 'gen3a_turbo';
    const duration = options.duration || 5;

    const body: Record<string, unknown> = {
      promptText: options.prompt,
      model,
      duration,
    };
    if (options.imageUrl) {
      body.promptImage = options.imageUrl;
    }

    const createRes = await fetch(`${API_BASE}/image_to_video`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
        'X-Runway-Version': '2024-11-06',
      },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json() as { id?: string; error?: string };
    if (!createData.id) {
      throw new Error(`Runway API error: ${createData.error || 'Unknown error'}`);
    }

    const videoUrl = await this.pollForResult(apiKey, createData.id);
    return this.downloadVideo(videoUrl);
  }

  private async pollForResult(apiKey: string, taskId: string, maxWait = 300000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 10000));
      const res = await fetch(`${API_BASE}/tasks/${taskId}`, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'X-Runway-Version': '2024-11-06',
        },
      });
      const data = await res.json() as { status?: string; output?: string[]; failure?: string };
      if (data.status === 'SUCCEEDED') {
        const url = data.output?.[0];
        if (url) return url;
        throw new Error('Runway: no output URL');
      }
      if (data.status === 'FAILED') {
        throw new Error(`Runway video failed: ${data.failure || 'Unknown'}`);
      }
    }
    throw new Error('Runway: timeout waiting for video');
  }

  private async downloadVideo(url: string): Promise<GeneratedVideo> {
    const res = await fetch(url);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const filename = `vid-${crypto.randomUUID()}.mp4`;
    const filePath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    const appUrl = process.env.APP_URL || `http://localhost:${config.port}`;
    return { url: `${appUrl}/uploads/${filename}`, localPath: filePath };
  }
}
