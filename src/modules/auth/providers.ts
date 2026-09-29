import { APP_URL } from './mail';

export interface ExternalIdentity { providerUserId: string; email: string; emailVerified: boolean; name: string }
export interface OAuthProvider {
  id: string; // stored in user_auth_identities.provider
  enabled(): boolean;
  authUrl(p: { state: string; nonce: string; challenge: string }): string;
  exchange(p: { code: string; verifier: string; nonce: string }): Promise<ExternalIdentity>;
}

const google: OAuthProvider = {
  id: 'GOOGLE',
  enabled: () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
  authUrl({ state, nonce, challenge }) {
    const q = new URLSearchParams({
      client_id: process.env.GOOGLE_CLIENT_ID || '', redirect_uri: redirectUri(), response_type: 'code',
      scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    });
    return `${process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth'}?${q}`;
  },
  async exchange({ code, verifier, nonce }) {
    // Server-side code exchange with client secret. The id_token comes straight from Google's token
    // endpoint over TLS, so per OIDC Core 3.1.3.7 we validate claims (no browser-supplied data is trusted).
    const r = await fetch(process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID || '', client_secret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: redirectUri(), grant_type: 'authorization_code', code_verifier: verifier }),
    });
    if (!r.ok) throw new Error('token_exchange_failed');
    const { id_token } = (await r.json()) as { id_token?: string };
    if (!id_token) throw new Error('no_id_token');
    const c = JSON.parse(Buffer.from(id_token.split('.')[1] || '', 'base64url').toString('utf8'));
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(c.iss)) throw new Error('bad_iss');
    if (c.aud !== process.env.GOOGLE_CLIENT_ID) throw new Error('bad_aud');
    if (!c.exp || c.exp * 1000 <= Date.now()) throw new Error('expired');
    if (c.nonce !== nonce) throw new Error('bad_nonce');
    if (!c.sub || !c.email) throw new Error('missing_claims');
    return { providerUserId: String(c.sub), email: String(c.email), emailVerified: c.email_verified === true || c.email_verified === 'true', name: String(c.name || c.email) };
  },
};
function redirectUri() { return process.env.GOOGLE_REDIRECT_URI || `${APP_URL}/api/auth/google/callback`; }

// Adding FACEBOOK later = one more entry here.
export const providers: Record<string, OAuthProvider> = { google };
