import { generateText } from '../content-generator';

export interface VideoScene {
  sceneNumber: number;
  duration: number;
  visualPrompt: string;
  voiceover: string;
}

export interface VideoScript {
  title: string;
  totalDuration: number;
  scenes: VideoScene[];
  fullVoiceover: string;
}

export async function generateVideoScript(options: {
  topic: string;
  totalDuration: number;
  style?: string;
  language?: string;
}): Promise<VideoScript> {
  const { topic, totalDuration, style = 'professional marketing', language = 'vi' } = options;

  const maxSceneDuration = 6;
  const sceneCount = Math.ceil(totalDuration / maxSceneDuration);
  const sceneDurations: number[] = [];
  let remaining = totalDuration;
  for (let i = 0; i < sceneCount; i++) {
    const d = Math.min(remaining, maxSceneDuration);
    sceneDurations.push(d);
    remaining -= d;
  }

  const result = await generateText({
    topic: `VIDEO SCRIPT GENERATION`,
    pageName: 'Video Pipeline',
    contentType: 'VIDEO',
    notes: `Create a video script about: "${topic}"
Style: ${style}
Language: ${language === 'vi' ? 'Vietnamese' : 'English'}
Total duration: ${totalDuration} seconds
Number of scenes: ${sceneCount}
Scene durations: ${sceneDurations.join(', ')} seconds each

RESPOND IN EXACTLY THIS JSON FORMAT (no markdown, no code blocks, just raw JSON):
{
  "title": "short video title",
  "scenes": [
    {
      "sceneNumber": 1,
      "duration": ${sceneDurations[0]},
      "visualPrompt": "Detailed English description for AI video generation. Describe camera angle, movement, lighting, colors, subjects, actions. Be cinematic and specific.",
      "voiceover": "Vietnamese voiceover text for this scene. Natural, engaging, matches the visual."
    }
  ]
}

IMPORTANT RULES:
- visualPrompt MUST be in English (for video AI)
- voiceover MUST be in ${language === 'vi' ? 'Vietnamese' : 'English'}
- Each visualPrompt should describe a SINGLE continuous shot
- Voiceover length should match scene duration (~2-3 words per second)
- Make scenes flow naturally as a story
- Include camera movements (pan, zoom, track) for dynamic feel
- Return ONLY the JSON, no other text`,
  });

  let parsed: { title: string; scenes: Array<{ sceneNumber: number; duration: number; visualPrompt: string; voiceover: string }> };

  try {
    let jsonStr = result.text;
    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/);
    if (jsonMatch) jsonStr = jsonMatch[0];
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`Failed to parse AI script response: ${result.text.substring(0, 200)}`);
  }

  if (!parsed.scenes || !Array.isArray(parsed.scenes) || parsed.scenes.length === 0) {
    throw new Error('AI returned no scenes');
  }

  const scenes: VideoScene[] = parsed.scenes.map((s, i) => ({
    sceneNumber: i + 1,
    duration: sceneDurations[i] || 5,
    visualPrompt: s.visualPrompt,
    voiceover: s.voiceover,
  }));

  const fullVoiceover = scenes.map(s => s.voiceover).join(' ');

  return {
    title: parsed.title || topic,
    totalDuration,
    scenes,
    fullVoiceover,
  };
}
