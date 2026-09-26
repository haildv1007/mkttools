import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../../../config';
import { getSetting } from '../../settings';
import type { VideoProvider, VideoGeneratorOptions, GeneratedVideo } from '../../../types';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');
const API_BASE = 'https://api.minimax.io/v1';

export class MinimaxVideoProvider implements VideoProvider {
  name = 'minimax';

  async generate(options: VideoGeneratorOptions): Promise<GeneratedVideo> {
    const apiKey = (await getSetting('MINIMAX_API_KEY')) || process.env.MINIMAX_API_KEY;
    if (!apiKey) throw new Error('MINIMAX_API_KEY chưa được cấu hình');

    const model = (await getSetting('AI_VIDEO_MODEL')) || 'MiniMax-Hailuo-02';

    const isV2 = model === 'MiniMax-H3';
    const apiVersion = isV2 ? 'v2' : 'v1';
    const apiUrl = `https://api.minimax.io/${apiVersion}/video_generation`;

    let body: Record<string, unknown>;
    if (isV2) {
      const content: Array<Record<string, unknown>> = [
        { type: 'text', text: options.prompt },
      ];
      if (options.imageUrl) {
        content.push({ type: 'image_url', image_url: { url: options.imageUrl } });
      }
      body = { model, content };
    } else {
      body = { model, prompt: options.prompt };
      if (options.imageUrl) {
        body.first_frame_image = options.imageUrl;
      }
    }
    console.log('[Minimax] Request:', JSON.stringify(body));
    console.log('[Minimax] API URL:', apiUrl);
    const createRes = await fetch(apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    const createData = await createRes.json() as Record<string, unknown>;
    console.log('[Minimax] Response:', JSON.stringify(createData).substring(0, 500));
    const taskId = (createData.task_id as string) || ((createData as any).id as string);
    if (!taskId) {
      throw new Error(`Minimax API error: ${JSON.stringify(createData)}`);
    }

    const videoUrl = await this.pollForResult(apiKey, taskId, isV2);
    return this.downloadVideo(videoUrl);
  }

  private async pollForResult(apiKey: string, taskId: string, isV2 = false, maxWait = 300000): Promise<string> {
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 10000));
      const pollUrl = isV2
        ? `https://api.minimax.io/v2/query/video_generation?task_id=${taskId}`
        : `${API_BASE}/query/video_generation?task_id=${taskId}`;
      const res = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const data = await res.json() as Record<string, unknown>;
      const status = (data.status as string) || '';
      console.log(`[Minimax] Poll status: ${status}`);

      if (status === 'Success' || status === 'Finished') {
        if (isV2) {
          const downloadUrl = (data as any).output?.video_url || (data as any).download_url;
          if (downloadUrl) return downloadUrl;
          const fileId = data.file_id as string;
          if (fileId) {
            const fileRes = await fetch(`${API_BASE}/files/retrieve?file_id=${fileId}`, {
              headers: { Authorization: `Bearer ${apiKey}` },
            });
            const fileData = await fileRes.json() as { file?: { download_url?: string } };
            if (fileData.file?.download_url) return fileData.file.download_url;
          }
          throw new Error(`Minimax: no download URL in v2 response: ${JSON.stringify(data).substring(0, 300)}`);
        }
        if (!data.file_id) throw new Error('Minimax: no file_id in result');
        const fileRes = await fetch(`${API_BASE}/files/retrieve?file_id=${data.file_id}`, {
          headers: { Authorization: `Bearer ${apiKey}` },
        });
        const fileData = await fileRes.json() as { file?: { download_url?: string } };
        const url = fileData.file?.download_url;
        if (url) return url;
        throw new Error('Minimax: no download URL');
      }
      if (status === 'Failed') {
        throw new Error(`Minimax video failed: ${JSON.stringify(data).substring(0, 300)}`);
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
