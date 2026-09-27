import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { config } from '../../../config';
import { getSetting } from '../../settings';
import type { VideoProvider, VideoGeneratorOptions, GeneratedVideo } from '../../../types';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'uploads');

export class SeedanceVideoProvider implements VideoProvider {
  name = 'seedance';

  async testConnection(): Promise<{ ok: boolean; error?: string }> {
    try {
      const apiKey = (await getSetting('FAL_API_KEY')) || process.env.FAL_API_KEY;
      if (!apiKey) return { ok: false, error: 'FAL_API_KEY chưa được cấu hình' };
      const res = await fetch('https://queue.fal.run/fal-ai/fast-sdxl', {
        method: 'OPTIONS',
        headers: { 'Authorization': `Key ${apiKey}` },
      });
      if (res.status === 401 || res.status === 403) return { ok: false, error: 'FAL_API_KEY không hợp lệ' };
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : 'Unknown error' };
    }
  }

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
    const submitText = await submitRes.text();
    let submitData: { request_id?: string; status_url?: string; response_url?: string; error?: string };
    try {
      submitData = JSON.parse(submitText);
    } catch {
      throw new Error(`Seedance: invalid submit response (${submitRes.status}): ${submitText.substring(0, 300)}`);
    }
    console.log(`[Seedance] Submit response:`, JSON.stringify(submitData).substring(0, 300));

    if (!submitData.request_id) {
      throw new Error(`Seedance API error: ${submitData.error || JSON.stringify(submitData)}`);
    }

    const statusUrl = submitData.status_url || `https://queue.fal.run/${endpoint}/requests/${submitData.request_id}/status`;
    const resultUrl = submitData.response_url || `https://queue.fal.run/${endpoint}/requests/${submitData.request_id}`;
    console.log(`[Seedance] Status URL: ${statusUrl}`);
    console.log(`[Seedance] Result URL: ${resultUrl}`);

    const maxWait = 600000;
    const start = Date.now();
    while (Date.now() - start < maxWait) {
      await new Promise(r => setTimeout(r, 10000));

      const statusRes = await fetch(statusUrl, {
        headers: { 'Authorization': `Key ${apiKey}` },
      });
      const statusText = await statusRes.text();
      let statusData: { status?: string };
      try {
        statusData = JSON.parse(statusText);
      } catch {
        console.log(`[Seedance] Poll returned non-JSON (${statusRes.status}): ${statusText.substring(0, 200)}`);
        continue;
      }
      console.log(`[Seedance] Poll status: ${statusData.status}`);

      if (statusData.status === 'COMPLETED') {
        const resultRes = await fetch(resultUrl, {
          headers: { 'Authorization': `Key ${apiKey}` },
        });
        const resultText = await resultRes.text();
        let resultData: { video?: { url?: string }; error?: string };
        try {
          resultData = JSON.parse(resultText);
        } catch {
          throw new Error(`Seedance: invalid result JSON: ${resultText.substring(0, 300)}`);
        }

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
