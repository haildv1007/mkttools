import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../../../config';
import { getSetting } from '../../settings';
import type { VideoProvider, VideoGeneratorOptions, GeneratedVideo } from '../../../types';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const API_BASE = 'https://api.klingai.com/v1';

export class KlingVideoProvider implements VideoProvider {
  name = 'kling';

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const apiKey = (await getSetting('KLING_API_KEY')) || process.env.KLING_API_KEY;
      if (!apiKey) return { ok: false, error: 'KLING_API_KEY chưa được cấu hình' };
      const res = await fetch(`${API_BASE}/models`, {
        headers: { 'Authorization': `Bearer ${apiKey}` },
      });
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'KLING_API_KEY không hợp lệ' };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

  async generate(options: VideoGeneratorOptions): Promise<GeneratedVideo> {
    const apiKey = (await getSetting('KLING_API_KEY')) || process.env.KLING_API_KEY;
    if (!apiKey) throw new Error('KLING_API_KEY chưa được cấu hình');

    const model = (await getSetting('AI_VIDEO_MODEL')) || 'kling-v2';
    const duration = options.duration || 5;
    const aspectRatio = options.aspectRatio || '16:9';

    const body: Record<string, unknown> = {
      model,
      prompt: options.prompt,
      duration: String(duration),
      aspect_ratio: aspectRatio,
      mode: 'std',
    };
    if (options.imageUrl) {
      body.image = options.imageUrl;
    }

    const createRes = await fetch(`${API_BASE}/videos/text2video`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json() as { code: number; data?: { task_id: string }; message?: string };
    if (createData.code !== 0 || !createData.data?.task_id) {
      throw new Error(`Kling API error: ${createData.message || 'Unknown error'}`);
    }

    const taskId = createData.data.task_id;
    const videoUrl = await this.pollForResult(apiKey, taskId);
    return this.downloadVideo(videoUrl);
  }

  private async pollForResult(apiKey: string, taskId: string, maxWait = 300000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 10000));
      const res = await fetch(`${API_BASE}/videos/text2video/${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json() as { code: number; data?: { task_status: string; task_result?: { videos?: Array<{ url: string }> } } };
      if (data.data?.task_status === 'succeed') {
        const url = data.data.task_result?.videos?.[0]?.url;
        if (url) return url;
        throw new Error('Kling: no video URL in result');
      }
      if (data.data?.task_status === 'failed') {
        throw new Error('Kling video generation failed');
      }
    }
    throw new Error('Kling: timeout waiting for video');
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
