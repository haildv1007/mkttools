import type { PublishResult } from '../../../types';

interface FacebookPostOptions {
  pageId: string;
  accessToken: string;
  message: string;
  imageUrl?: string;
  scheduledTime?: number;
}

const GRAPH_API = 'https://graph.facebook.com/v21.0';

export async function publishToFacebook(options: FacebookPostOptions): Promise<PublishResult> {
  try {
    let endpoint: string;
    let body: Record<string, string>;

    if (options.imageUrl) {
      endpoint = `${GRAPH_API}/${options.pageId}/photos`;
      body = {
        url: options.imageUrl,
        caption: options.message,
        access_token: options.accessToken,
      };
    } else {
      endpoint = `${GRAPH_API}/${options.pageId}/feed`;
      body = {
        message: options.message,
        access_token: options.accessToken,
      };
    }

    if (options.scheduledTime) {
      body.published = 'false';
      body.scheduled_publish_time = String(options.scheduledTime);
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body),
    });

    const data = await res.json() as { id?: string; post_id?: string; error?: { message: string } };

    if (data.error) {
      return { success: false, error: data.error.message };
    }

    const postId = data.post_id || data.id || '';
    return {
      success: true,
      postId,
      url: `https://facebook.com/${postId}`,
    };
  } catch (err) {
    return {
      success: false,
      error: err instanceof Error ? err.message : 'Unknown Facebook API error',
    };
  }
}

export async function getPageInfo(pageId: string, accessToken: string) {
  const res = await fetch(
    `${GRAPH_API}/${pageId}?fields=name,fan_count,picture&access_token=${accessToken}`
  );
  return res.json();
}

export async function getPostMetrics(postId: string, accessToken: string) {
  const res = await fetch(
    `${GRAPH_API}/${postId}/insights?metric=post_impressions,post_engaged_users,post_reactions_by_type_total&access_token=${accessToken}`
  );
  return res.json();
}
