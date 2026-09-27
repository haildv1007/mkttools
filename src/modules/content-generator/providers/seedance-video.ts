import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../../../config';
import { getSetting } from '../../settings';
import type { VideoProvider, VideoGeneratorOptions, GeneratedVideo } from '../../../types';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

export class SeedanceVideoProvider implements VideoProvider {
  name = 'seedance';

  async generate(options: VideoGeneratorOptions): Promise<GeneratedVideo> {
    const apiKey = (await getSetting('FAL_API_KEY')) || process.env.FAL_API_KEY;
    if (!apiKey) throw new Error('FAL_API_KEY chưa được cấu hình');

    const model = (await getSetting('AI_VIDEO_MODEL')) || 'seedance-2.0';
    const duration = options.duration || 5;

    const modelEndpoints: Record<string, string> = {
      'seedance-2.5': 'bytedance/seedance-2.5/text-to-video',
      'seedance-2.0': 'bytedance/seedance-2.0/text-to-video',
      'seedance-2.0-fast': 'bytedance/seedance-2.0/fast/text-to-video',
    };
    const endpoint = modelEndpoints[model] || modelEndpoints['seedance-2.0'];

    const body: Record<string, unknown> = {
      prompt: options.prompt,
      duration: String(duration),
      resolution: '720p',
      aspect_ratio: options.aspectRatio || '16:9',
      generate_audio: true,
    };

    if (options.imageUrl) {
      const i2vEndpoint = endpoint.replace('text-to-video', 'image-to-video');
      body.image_url = options.imageUrl;
      console.log(`[Seedance] Image-to-video with model ${model}`);
      return this.submitAndPoll(apiKey, i2vEndpoint, body);
    }

    console.log(`[Seedance] Text-to-video with model ${model}, duration ${duration}s`);
    return this.submitAndPoll(apiKey, endpoint, body);
  }

  private async submitAndPoll(apiKey: string, endpoint: string, body: Record<string, unknown>): Promise<GeneratedVideo> {
    const submitUrl = `https://queue.fal.run/${endpoint}`;
    console.log(`[Seedance] Submitting to ${submitUrl}`);

    const submitRes = await fetch(submitUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Key ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    const submitData = await submitRes.json() as { request_id?: string; status_url?: string; error?: string };
    console.log(`[Seedance] Submit response:`, JSON.stringify(submitData).substring(0, 300));

    if (!submitData.request_id) {
      throw new Error(`Seedance API error: ${submitData.error || JSON.stringify(submitData)}`);
    }

    const requestId = submitData.request_id;
    const statusUrl = `https://queue.fal.run/${endpoint}/requests/${requestId}/status`;
    const resultUrl = `https://queue.fal.run/${endpoint}/requests/${requestId}`;

    const maxWait = 600000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 10000));

      const statusRes = await fetch(statusUrl, {
        headers: { 'Authorization': `Key ${apiKey}` },
      });
      const statusData = await statusRes.json() as { status?: string };
      console.log(`[Seedance] Poll status: ${statusData.status}`);

      if (statusData.status === 'COMPLETED') {
        const resultRes = await fetch(resultUrl, {
          headers: { 'Authorization': `Key ${apiKey}` },
        });
        const resultData = await resultRes.json() as { video?: { url?: string }; error?: string };

        const videoUrl = resultData.video?.url;
        if (!videoUrl) throw new Error(`Seedance: no video URL in result: ${JSON.stringify(resultData).substring(0, 300)}`);

        return this.downloadVideo(videoUrl);
      }

      if (statusData.status === 'FAILED') {
        throw new Error('Seedance: video generation failed');
      }
    }
    throw new Error('Seedance: timeout waiting for video (10 min)');
  }

  private async downloadVideo(url: string): Promise<GeneratedVideo> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Seedance: failed to download video (${res.status})`);
    const buffer = Buffer.from(await res.arrayBuffer());
    if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    const filename = `vid-${crypto.randomUUID()}.mp4`;
    const filePath = path.join(UPLOAD_DIR, filename);
    fs.writeFileSync(filePath, buffer);
    const appUrl = process.env.APP_URL || `http://localhost:${config.port}`;
    return { url: `${appUrl}/uploads/${filename}`, localPath: filePath };
  }
}
