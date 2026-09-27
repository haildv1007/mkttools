import * as fs from 'fs';
import type { PublishResult } from '../../../types';

interface FacebookPostOptions {
  pageId: string;
  accessToken: string;
  message: string;
  imageUrl?: string;
  imageLocalPath?: string;
  images?: Array<{url: string; localPath?: string}>;
  scheduledTime?: number;
}

const GRAPH_API = 'https://graph.facebook.com/v21.0';

async function uploadUnpublishedPhoto(pageId: string, accessToken: string, localPath: string): Promise<string> {
  const endpoint = `${GRAPH_API}/${pageId}/photos`;
  const form = new FormData();
  const fileBuffer = fs.readFileSync(localPath);
  form.append('source', new Blob([fileBuffer], { type: 'image/png' }), 'image.png');
  form.append('published', 'false');
  form.append('access_token', accessToken);
  const res = await fetch(endpoint, { method: 'POST', body: form });
  const data = await res.json() as { id?: string; error?: { message: string } };
  if (data.error || !data.id) throw new Error(data.error?.message || 'Failed to upload photo');
  return data.id;
}

export async function publishToFacebook(options: FacebookPostOptions): Promise<PublishResult> {
  try {
    // Multi-image album post
    if (options.images && options.images.length > 1) {
      const photoIds: string[] = [];
      for (const img of options.images) {
        const localPath = img.localPath && fs.existsSync(img.localPath) ? img.localPath : null;
        if (localPath) {
          const id = await uploadUnpublishedPhoto(options.pageId, options.accessToken, localPath);
          photoIds.push(id);
        }
      }
      if (photoIds.length === 0) {
        return { success: false, error: 'No images uploaded for album' };
      }
      const endpoint = `${GRAPH_API}/${options.pageId}/feed`;
      const params = new URLSearchParams({
        message: options.message,
        access_token: options.accessToken,
      });
      photoIds.forEach((id, i) => {
        params.append(`attached_media[${i}]`, JSON.stringify({ media_fbid: id }));
      });
      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: params,
      });
      const data = await res.json() as { id?: string; error?: { message: string } };
      if (data.error) return { success: false, error: data.error.message };
      return { success: true, postId: data.id || '', url: `https://facebook.com/${data.id}` };
    }

    let endpoint: string;
    let fetchBody: string | FormData | URLSearchParams;
    let headers: Record<string, string> = {};

    if (options.imageLocalPath && fs.existsSync(options.imageLocalPath)) {
      // Upload image file directly to Facebook
      endpoint = `${GRAPH_API}/${options.pageId}/photos`;
      const form = new FormData();
      const fileBuffer = fs.readFileSync(options.imageLocalPath);
      form.append('source', new Blob([fileBuffer], { type: 'image/png' }), 'image.png');
      form.append('caption', options.message);
      form.append('access_token', options.accessToken);
      if (options.scheduledTime) {
        form.append('published', 'false');
        form.append('scheduled_publish_time', String(options.scheduledTime));
      }
      fetchBody = form;
    } else if (options.imageUrl) {
      endpoint = `${GRAPH_API}/${options.pageId}/photos`;
      const body: Record<string, string> = {
        url: options.imageUrl,
        caption: options.message,
        access_token: options.accessToken,
      };
      if (options.scheduledTime) {
        body.published = 'false';
        body.scheduled_publish_time = String(options.scheduledTime);
      }
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchBody = new URLSearchParams(body);
    } else {
      endpoint = `${GRAPH_API}/${options.pageId}/feed`;
      const body: Record<string, string> = {
        message: options.message,
        access_token: options.accessToken,
      };
      if (options.scheduledTime) {
        body.published = 'false';
        body.scheduled_publish_time = String(options.scheduledTime);
      }
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      fetchBody = new URLSearchParams(body);
    }

    const res = await fetch(endpoint, {
      method: 'POST',
      ...(Object.keys(headers).length ? { headers } : {}),
      body: fetchBody,
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
