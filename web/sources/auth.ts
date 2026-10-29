
import type { Source } from './index';

export interface Tokens {
  access: string;
  refresh?: string;
  expiresAt?: number;
}

export interface Pending {
  sourceId: string;
  state: string;
  verifier: string;
  redirectUri: string;
  tokenUrl: string;
  clientId: string;
}

interface Endpoints { authorize: string; token: string; revoke?: string }

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function makeVerifier(rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  return b64url(rand(32));
}

export async function challengeOf(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return b64url(new Uint8Array(digest));
}

export async function endpointsOf(source: Source, fetchFn: typeof fetch = fetch): Promise<Endpoints> {
  const a = source.auth;
  if (a.type === 'oauth2') return { authorize: a.authorize, token: a.token, revoke: a.revoke };
  if (a.type !== 'oidc') throw new Error('no sign-in');
  const res = await fetchFn(`${a.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`, { credentials: 'omit' });
  if (!res.ok) throw new Error(`discovery ${res.status}`);
  const d = await res.json() as Record<string, unknown>;
  if (typeof d.authorization_endpoint !== 'string' || typeof d.token_endpoint !== 'string') throw new Error('discovery has no endpoints');
  return { authorize: d.authorization_endpoint, token: d.token_endpoint, revoke: typeof d.revocation_endpoint === 'string' ? d.revocation_endpoint : undefined };
}

export async function beginSignIn(source: Source, redirectUri: string, fetchFn: typeof fetch = fetch): Promise<{ url: string; pending: Pending }> {
  const a = source.auth;
  if (a.type === 'none') throw new Error('no sign-in');
  const ep = await endpointsOf(source, fetchFn);
  const verifier = makeVerifier();
  const state = makeVerifier();
  const u = new URL(ep.authorize);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('client_id', a.clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  if (a.scope) u.searchParams.set('scope', a.scope);
  u.searchParams.set('state', state);
  u.searchParams.set('code_challenge', await challengeOf(verifier));
  u.searchParams.set('code_challenge_method', 'S256');
  return { url: u.href, pending: { sourceId: source.id, state, verifier, redirectUri, tokenUrl: ep.token, clientId: a.clientId } };
}

async function tokenRequest(url: string, body: Record<string, string>, fetchFn: typeof fetch): Promise<Tokens> {
  const res = await fetchFn(url, {
    method: 'POST',
    credentials: 'omit',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: new URLSearchParams(body).toString(),
  });
  const j = await res.json().catch(() => ({})) as Record<string, unknown>;
  if (!res.ok || typeof j.access_token !== 'string') {
    throw new Error(typeof j.error_description === 'string' ? j.error_description : typeof j.error === 'string' ? j.error : `token ${res.status}`);
  }
  const t: Tokens = { access: j.access_token };
  if (typeof j.refresh_token === 'string') t.refresh = j.refresh_token;
  if (typeof j.expires_in === 'number') t.expiresAt = Date.now() + j.expires_in * 1000;
  return t;
}

export async function finishSignIn(pending: Pending, callbackUrl: string, fetchFn: typeof fetch = fetch): Promise<Tokens> {
  const q = new URL(callbackUrl).searchParams;
  if (q.get('state') !== pending.state) throw new Error('state mismatch');
  const err = q.get('error');
  if (err) throw new Error(q.get('error_description') ?? err);
  const code = q.get('code');
  if (!code) throw new Error('no code');
  return tokenRequest(pending.tokenUrl, {
    grant_type: 'authorization_code', code, redirect_uri: pending.redirectUri,
    client_id: pending.clientId, code_verifier: pending.verifier,
  }, fetchFn);
}

export async function refresh(source: Source, tokens: Tokens, fetchFn: typeof fetch = fetch): Promise<Tokens> {
  const a = source.auth;
  if (a.type === 'none' || !tokens.refresh) throw new Error('cannot refresh');
  const ep = await endpointsOf(source, fetchFn);
  const t = await tokenRequest(ep.token, { grant_type: 'refresh_token', refresh_token: tokens.refresh, client_id: a.clientId }, fetchFn);
  return t.refresh ? t : { ...t, refresh: tokens.refresh };
}

export async function revoke(source: Source, tokens: Tokens, fetchFn: typeof fetch = fetch): Promise<void> {
  const a = source.auth;
  if (a.type === 'none') return;
  try {
    const ep = await endpointsOf(source, fetchFn);
    if (!ep.revoke) return;
    const token = tokens.refresh ?? tokens.access;
    await fetchFn(ep.revoke, {
      method: 'POST', credentials: 'omit',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token, client_id: a.clientId }).toString(),
    });
  } catch {  }
}
