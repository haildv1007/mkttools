export function extractCleanText(raw: string): string {
  try {
    let cleaned = raw.trim();
    const jsonMatch = cleaned.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (jsonMatch) cleaned = jsonMatch[1].trim();
    try {
      const parsed = JSON.parse(cleaned);
      if (parsed.text) {
        let text = parsed.text;
        if (parsed.hashtags?.length) {
          text += '\n\n' + parsed.hashtags.map((h: string) => `#${String(h).replace(/^#/, '')}`).join(' ');
        }
        if (parsed.cta) text += '\n\n' + parsed.cta;
        return text;
      }
    } catch {}
    const textMatch = cleaned.match(/"text"\s*:\s*"([\s\S]*?)(?:"\s*[,}]|"$)/);
    if (textMatch) {
      let text = textMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\');
      const hashtagsMatch = cleaned.match(/"hashtags"\s*:\s*\[([\s\S]*?)\]/);
      if (hashtagsMatch) {
        const tags = hashtagsMatch[1].match(/"([^"]+)"/g);
        if (tags?.length) {
          text += '\n\n' + tags.map(t => {
            const tag = t.replace(/"/g, '').replace(/^#/, '');
            return `#${tag}`;
          }).join(' ');
        }
      }
      const ctaMatch = cleaned.match(/"cta"\s*:\s*"([\s\S]*?)(?:"\s*[,}]|"$)/);
      if (ctaMatch) {
        text += '\n\n' + ctaMatch[1].replace(/\\n/g, '\n').replace(/\\"/g, '"');
      }
      return text;
    }
  } catch {}
  return raw;
}
