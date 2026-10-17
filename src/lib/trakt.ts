import type { TraktAuth, TraktKeys, TraktList } from '../types';

export const TRAKT_API = 'https://api.trakt.tv';
/** Trakt asks for all OAuth requests to go to the auth hostname. */
export const TRAKT_AUTH = 'https://auth.trakt.tv';
/**
 * The redirect URI registered in the user's Trakt app. The device flow never redirects,
 * but Trakt requires it to match when refreshing a token, so we use this page's address.
 */
export function appRedirectUri(): string {
  const { origin, pathname } = window.location;
  return origin + pathname.replace(/index\.html$/, '');
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class TraktError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function postJson(path: string, body: unknown): Promise<Response> {
  return fetch(`${TRAKT_AUTH}${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/**
 * The client secret is optional (deprecated by Trakt; new apps get none and sign in
 * with the Client ID only). It is sent only when the user entered one.
 */
export function secretPart(keys: TraktKeys): { client_secret?: string } {
  return keys.clientSecret ? { client_secret: keys.clientSecret } : {};
}

function toAuth(t: any): TraktAuth {
  const created = typeof t.created_at === 'number' ? t.created_at * 1000 : Date.now();
  return {
    accessToken: t.access_token,
    refreshToken: t.refresh_token,
    expiresAt: created + (Number(t.expires_in) || 0) * 1000,
  };
}

// ---------- Device authentication ----------

export interface DeviceCode {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  expiresIn: number;
  interval: number;
}

export async function requestDeviceCode(clientId: string): Promise<DeviceCode> {
  const res = await postJson('/oauth/device/code', { client_id: clientId });
  if (!res.ok) {
    throw new TraktError(res.status, res.status === 401 || res.status === 403 ? 'err.clientId' : 'err.trakt');
  }
  const d = await res.json();
  return {
    deviceCode: d.device_code,
    userCode: d.user_code,
    verificationUrl: d.verification_url,
    expiresIn: d.expires_in,
    interval: d.interval,
  };
}

/**
 * Polls until the user approves the code, it expires, is denied, or the signal aborts.
 * Status codes per the Trakt device flow: 400 pending, 404 invalid code, 409 already used,
 * 410 expired, 418 denied, 429 polling too fast.
 */
export async function pollDeviceToken(
  keys: TraktKeys,
  code: DeviceCode,
  signal: AbortSignal,
): Promise<TraktAuth> {
  let interval = Math.max(1, code.interval) * 1000;
  const deadline = Date.now() + code.expiresIn * 1000;

  while (!signal.aborted) {
    await sleep(interval);
    if (signal.aborted) break;
    if (Date.now() > deadline) throw new TraktError(410, 'err.codeExpired');

    let res: Response;
    try {
      res = await postJson('/oauth/device/token', {
        code: code.deviceCode,
        client_id: keys.clientId,
        ...secretPart(keys),
      });
    } catch {
      continue; // temporary network problem: keep polling
    }

    if (res.status === 200) return toAuth(await res.json());
    switch (res.status) {
      case 400: break; // still pending
      case 429: interval += 1000; break;
      case 401: case 403:
        throw new TraktError(res.status, 'err.keys');
      case 404: throw new TraktError(404, 'err.codeInvalid');
      case 409: throw new TraktError(409, 'err.codeUsed');
      case 410: throw new TraktError(410, 'err.codeExpired');
      case 418: throw new TraktError(418, 'err.denied');
      default: break; // 5xx etc.: retry
    }
  }
  throw new TraktError(0, 'aborted');
}

export async function refreshToken(keys: TraktKeys, auth: TraktAuth): Promise<TraktAuth> {
  const res = await postJson('/oauth/token', {
    refresh_token: auth.refreshToken,
    client_id: keys.clientId,
    ...secretPart(keys),
    redirect_uri: appRedirectUri(),
    grant_type: 'refresh_token',
  });
  if (!res.ok) throw new TraktError(res.status, 'err.refresh');
  return toAuth(await res.json());
}

export async function revokeToken(keys: TraktKeys, auth: TraktAuth): Promise<void> {
  try {
    await postJson('/oauth/revoke', {
      token: auth.accessToken,
      client_id: keys.clientId,
      ...secretPart(keys),
    });
  } catch {
    /* best effort */
  }
}

// ---------- Authenticated client ----------

export class TraktClient {
  constructor(
    private keys: TraktKeys,
    private auth: TraktAuth,
    /** Called whenever tokens change (refresh) or become invalid (null). */
    private onAuth: (auth: TraktAuth | null) => void,
  ) {}

  private async ensureFresh() {
    // Refresh a little before expiry.
    if (this.auth.expiresAt && Date.now() > this.auth.expiresAt - 60_000) await this.refresh();
  }

  private async refresh() {
    try {
      this.auth = await refreshToken(this.keys, this.auth);
      this.onAuth(this.auth);
    } catch (e) {
      this.onAuth(null);
      throw new TraktError(401, 'err.session');
    }
  }

  async request<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<T> {
    return (await this.requestRaw<T>(method, path, body)).data;
  }

  /** GETs every page of a paginated endpoint (follows X-Pagination-Page-Count). */
  async getAll<T>(path: string, limit = 100, signal?: AbortSignal): Promise<T[]> {
    const out: T[] = [];
    const sep = path.includes('?') ? '&' : '?';
    for (let page = 1; page <= 500; page++) {
      if (signal?.aborted) throw new TraktError(0, 'aborted');
      const { data, headers } = await this.requestRaw<T[]>('GET', `${path}${sep}page=${page}&limit=${limit}`);
      if (Array.isArray(data)) out.push(...data);
      const pageCount = Number(headers.get('X-Pagination-Page-Count'));
      if (!pageCount || page >= pageCount || !Array.isArray(data) || data.length === 0) break;
    }
    return out;
  }

  private async requestRaw<T>(method: 'GET' | 'POST' | 'DELETE', path: string, body?: unknown): Promise<{ data: T; headers: Headers }> {
    await this.ensureFresh();
    let refreshed = false;
    for (let attempt = 0; attempt < 5; attempt++) {
      const res = await fetch(`${TRAKT_API}${path}`, {
        method,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.auth.accessToken}`,
          'trakt-api-version': '2',
          'trakt-api-key': this.keys.clientId,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (res.ok) {
        const data = (res.status === 204 ? undefined : await res.json()) as T;
        return { data, headers: res.headers };
      }
      if (res.status === 401 && !refreshed) {
        refreshed = true;
        await this.refresh();
        continue;
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get('Retry-After'));
        await sleep((retryAfter > 0 ? retryAfter : 2 ** attempt) * 1000);
        continue;
      }
      if (res.status === 401) this.onAuth(null);
      throw new TraktError(res.status, 'err.trakt');
    }
    throw new TraktError(429, 'err.rateLimit');
  }

  me() {
    return this.request<{ username: string }>('GET', '/users/me');
  }

  async lists(): Promise<TraktList[]> {
    const lists = await this.request<any[]>('GET', '/users/me/lists');
    return lists.map((l) => ({ id: l.ids.trakt, name: l.name }));
  }
}

