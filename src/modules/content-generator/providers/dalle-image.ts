import OpenAI from 'openai';
import { config } from '../../../config';
import type { ImageProvider, ImageGeneratorOptions, GeneratedImage } from '../../../types';

export class DalleImageProvider implements ImageProvider {
  name = 'dalle';
  private client: OpenAI;

  constructor() {
    this.client = new OpenAI({ apiKey: config.ai.image.openaiApiKey });
  }

  async generate(options: ImageGeneratorOptions): Promise<GeneratedImage> {
    const response = await this.client.images.generate({
      model: 'dall-e-3',
      prompt: options.prompt,
      size: '1024x1024',
      quality: 'standard',
      n: 1,
    });

    const url = response.data?.[0]?.url;
    if (!url) throw new Error('DALL-E returned no image');

    return { url };
  }
}
