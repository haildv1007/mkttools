import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../../../config';
import { getSetting } from '../../settings';
import type { VideoProvider, VideoGeneratorOptions, GeneratedVideo } from '../../../types';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const API_BASE = 'https://api.minimaxi.chat/v1';

export class MinimaxVideoProvider implements VideoProvider {
  name = 'minimax';

  async generate(options: VideoGeneratorOptions): Promise<GeneratedVideo> {
    const apiKey = (await getSetting('MINIMAX_API_KEY')) || process.env.MINIMAX_API_KEY;
    if (!apiKey) throw new Error('MINIMAX_API_KEY chưa được cấu hình');

    const model = (await getSetting('AI_VIDEO_MODEL')) || 'T2V-01';

    const body: Record<string, unknown> = {
      model,
      prompt: options.prompt,
    };
    if (options.imageUrl) {
      body.first_frame_image = options.imageUrl;
    }

    const createRes = await fetch(`${API_BASE}/video_generation`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json() as { task_id?: string; base_resp?: { status_code: number; status_msg: string } };
    if (!createData.task_id) {
      throw new Error(`Minimax API error: ${createData.base_resp?.status_msg || 'Unknown error'}`);
    }

    const videoUrl = await this.pollForResult(apiKey, createData.task_id);
    return this.downloadVideo(videoUrl);
  }

  private async pollForResult(apiKey: string, taskId: string, maxWait = 300000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 10000));
      const res = await fetch(`${API_BASE}/query/video_generation?task_id=${taskId}`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json() as { status?: string; file_id?: string; base_resp?: { status_msg: string } };
      if (data.status === 'Success' || data.status === 'Finished') {
        if (!data.file_id) throw new Error('Minimax: no file_id in result');
        const fileRes = await fetch(`${API_BASE}/files/retrieve?file_id=${data.file_id}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const fileData = await fileRes.json() as { file?: { download_url?: string } };
        const url = fileData.file?.download_url;
        if (url) return url;
        throw new Error('Minimax: no download URL');
      }
      if (data.status === 'Failed') {
        throw new Error(`Minimax video failed: ${data.base_resp?.status_msg || 'Unknown'}`);
      }
    }
    throw new Error('Minimax: timeout waiting for video');
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
