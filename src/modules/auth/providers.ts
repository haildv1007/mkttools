import { APP_URL } from './mail';
import { getPlatformSetting, resolveGoogleEnabled } from '../platform-settings';

export interface ExternalIdentity { providerUserId: string; email: string; emailVerified: boolean; name: string }
export interface OAuthProvider {
  id: string; // stored in user_auth_identities.provider
  enabled(): boolean;
  authUrl(p: { state: string; nonce: string; challenge: string }): string;
  exchange(p: { code: string; verifier: string; nonce: string }): Promise<ExternalIdentity>;
}

function clientId(): string { return getPlatformSetting('auth.googleClientId'); }
function clientSecret(): string { return getPlatformSetting('auth.googleClientSecret'); }

const google: OAuthProvider = {
  id: 'GOOGLE',
  // Admin toggle wins; a fresh install with only env creds still works
  // until the toggle is explicitly set (see resolveGoogleEnabled). Either
  // way, credentials must actually be present to really work.
  enabled: () => resolveGoogleEnabled() && !!clientId() && !!clientSecret(),
  authUrl({ state, nonce, challenge }) {
    const q = new URLSearchParams({
      client_id: clientId(), redirect_uri: redirectUri(), response_type: 'code',
      scope: 'openid email profile', state, nonce, code_challenge: challenge, code_challenge_method: 'S256', prompt: 'select_account',
    });
    return `${process.env.GOOGLE_AUTH_URL || 'https://accounts.google.com/o/oauth2/v2/auth'}?${q}`;
  },
  async exchange({ code, verifier, nonce }) {
    // Server-side code exchange with client secret. The id_token comes straight from Google's token
    // endpoint over TLS, so per OIDC Core 3.1.3.7 we validate claims (no browser-supplied data is trusted).
    const r = await fetch(process.env.GOOGLE_TOKEN_URL || 'https://oauth2.googleapis.com/token', {
      method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ code, client_id: clientId(), client_secret: clientSecret(),
        redirect_uri: redirectUri(), grant_type: 'authorization_code', code_verifier: verifier }),
    });
    if (!r.ok) throw new Error('token_exchange_failed');
    const { id_token } = (await r.json()) as { id_token?: string };
    if (!id_token) throw new Error('no_id_token');
    const c = JSON.parse(Buffer.from(id_token.split('.')[1] || '', 'base64url').toString('utf8'));
    if (!['https://accounts.google.com', 'accounts.google.com'].includes(c.iss)) throw new Error('bad_iss');
    if (c.aud !== clientId()) throw new Error('bad_aud');
    if (!c.exp || c.exp * 1000 <= Date.now()) throw new Error('expired');
    if (c.nonce !== nonce) throw new Error('bad_nonce');
    if (!c.sub || !c.email) throw new Error('missing_claims');
    return { providerUserId: String(c.sub), email: String(c.email), emailVerified: c.email_verified === true || c.email_verified === 'true', name: String(c.name || c.email) };
  },
};
function redirectUri(): string { return getPlatformSetting('auth.googleRedirectUri') || `${APP_URL()}/api/auth/google/callback`; }

// Adding FACEBOOK later = one more entry here.
export const providers: Record<string, OAuthProvider> = { google };
