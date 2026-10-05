import crypto from 'crypto';
import * as redis from './redis';

const STATE_TTL_SECONDS = 600; // 10 minutes

export interface OAuthStateBag {
  userId: string;
  organizationId: string;
  redirectUri: string;
  nonce: string;
}

export async function createOAuthState(userId: string, organizationId: string, redirectUri: string): Promise<string> {
  const nonce = crypto.randomBytes(24).toString('hex');
  const bag: OAuthStateBag = { userId, organizationId, redirectUri, nonce };
  await redis.set(`oauth_state:${nonce}`, JSON.stringify(bag), STATE_TTL_SECONDS);
  return nonce;
}

export async function validateAndConsumeOAuthState(
  state: string,
  expectedUserId: string,
): Promise<OAuthStateBag | null> {
  const raw = await redis.getAndDelete(`oauth_state:${state}`);
  if (!raw) return null;
  try {
    const bag: OAuthStateBag = JSON.parse(raw);
    if (bag.userId !== expectedUserId) return null;
    return bag;
  } catch {
    return null;
  }
}
