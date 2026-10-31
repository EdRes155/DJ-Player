import { describe, it, expect, beforeEach, vi } from 'vitest';
import { refreshToken, logout, getMe } from '../src/services/spotifyAPI.js';

const json = (status, data) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' }
});

function seedExpiredSession() {
  localStorage.setItem('sp_token', 'old');
  localStorage.setItem('sp_refresh', 'refresh-1');
  localStorage.setItem('sp_expires', '0'); // vencido → obliga a renovar
}

describe('spotifyAPI', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('F03: una renovación pendiente no restaura credenciales después de logout()', async () => {
    seedExpiredSession();
    let resolveFetch;
    globalThis.fetch = vi.fn(() => new Promise((r) => { resolveFetch = r; }));

    const pending = refreshToken();
    await logout();
    expect(localStorage.getItem('sp_token')).toBeNull();

    resolveFetch(json(200, { access_token: 'new', refresh_token: 'r2', expires_in: 3600 }));
    expect(await pending).toBeNull();
    expect(localStorage.getItem('sp_token')).toBeNull();
    expect(localStorage.getItem('sp_refresh')).toBeNull();
    expect(localStorage.getItem('sp_expires')).toBeNull();
  });

  it('F06: ante un 401 persistente hace como máximo una renovación y un reintento', async () => {
    seedExpiredSession();
    const calls = { api: 0, token: 0 };
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes('accounts.spotify.com')) {
        calls.token += 1;
        return json(200, { access_token: `t${calls.token}`, expires_in: 3600 });
      }
      calls.api += 1;
      return json(401, { error: { status: 401 } });
    });

    await expect(getMe()).rejects.toThrow('UNAUTHORIZED');
    expect(calls.api).toBe(2);
    expect(calls.token).toBe(2); // 1 por token vencido + 1 por el 401
  });

  it('renovaciones simultáneas comparten una sola petición', async () => {
    seedExpiredSession();
    globalThis.fetch = vi.fn(async () => json(200, { access_token: 'n', expires_in: 3600 }));
    const [a, b] = await Promise.all([refreshToken(), refreshToken()]);
    expect(a).toBe('n');
    expect(b).toBe('n');
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('acepta respuestas 200/202 sin cuerpo (comandos de reproducción)', async () => {
    localStorage.setItem('sp_token', 'ok');
    localStorage.setItem('sp_expires', String(Date.now() + 3600_000));
    globalThis.fetch = vi.fn(async () => new Response('', { status: 202 }));
    await expect(getMe()).resolves.toBeNull();
  });
});
