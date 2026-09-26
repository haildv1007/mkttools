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

  async generate(options: VideoGeneratorOptions): Promise<GeneratedVideo> {
    const accessKey = (await getSetting('KLING_ACCESS_KEY')) || process.env.KLING_ACCESS_KEY;
    const secretKey = (await getSetting('KLING_SECRET_KEY')) || process.env.KLING_SECRET_KEY;
    if (!accessKey || !secretKey) throw new Error('KLING_ACCESS_KEY / KLING_SECRET_KEY chưa được cấu hình');

    const model = (await getSetting('AI_VIDEO_MODEL')) || 'kling-v2';
    const duration = options.duration || 5;
    const aspectRatio = options.aspectRatio || '16:9';

    const token = await this.getJwtToken(accessKey, secretKey);

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
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json() as { code: number; data?: { task_id: string }; message?: string };
    if (createData.code !== 0 || !createData.data?.task_id) {
      throw new Error(`Kling API error: ${createData.message || 'Unknown error'}`);
    }

    const taskId = createData.data.task_id;
    const videoUrl = await this.pollForResult(token, taskId);
    return this.downloadVideo(videoUrl);
  }

  private async getJwtToken(accessKey: string, secretKey: string): Promise<string> {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload = Buffer.from(JSON.stringify({
      iss: accessKey,
      exp: now + 1800,
      nbf: now - 5,
      iat: now,
    })).toString('base64url');
    const signature = crypto.createHmac('sha256', secretKey)
      .update(`${header}.${payload}`)
      .digest('base64url');
    return `${header}.${payload}.${signature}`;
  }

  private async pollForResult(token: string, taskId: string, maxWait = 300000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 10000));
      const res = await fetch(`${API_BASE}/videos/text2video/${taskId}`, {
        headers: { Authorization: `Bearer ${token}` },
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
