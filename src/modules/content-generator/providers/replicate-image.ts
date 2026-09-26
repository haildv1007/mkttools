import { config } from '../../../config';
import type { ImageProvider, ImageGeneratorOptions, GeneratedImage } from '../../../types';

export class ReplicateImageProvider implements ImageProvider {
  name = 'replicate';
  private apiKey: string;

  constructor() {
    this.apiKey = config.ai.image.replicateApiKey;
  }

  async generate(options: ImageGeneratorOptions): Promise<GeneratedImage> {
    const model = config.ai.image.defaultModel === 'flux-schnell'
      ? 'black-forest-labs/flux-schnell'
      : 'black-forest-labs/flux-dev';

    const response = await fetch('https://api.replicate.com/v1/predictions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        input: {
          prompt: options.prompt,
          width: options.width || 1024,
          height: options.height || 1024,
          num_outputs: 1,
        },
      }),
    });

    const prediction = await response.json() as { id: string; urls: { get: string } };
    const result = await this.waitForResult(prediction.urls.get);
    return { url: result };
  }

  private async waitForResult(getUrl: string, maxRetries = 30): Promise<string> {
    for (let i = 0; i < maxRetries; i++) {
      await new Promise(r => setTimeout(r, 2000));

      const res = await fetch(getUrl, {
        headers: { 'Authorization': `Bearer ${this.apiKey}` },
      });
      const data = await res.json() as { status: string; output?: string[]; error?: string };

      if (data.status === 'succeeded' && data.output?.[0]) {
        return data.output[0];
      }
      if (data.status === 'failed') {
        throw new Error(`Image generation failed: ${data.error}`);
      }
    }
    throw new Error('Image generation timed out');
  }
}
