import { describe, it, expect, vi } from 'vitest';
import { createTtsHandler, MAX_TEXT_LENGTH } from '../api/_lib/tts.js';

const ENV = {
  ELEVENLABS_API_KEY: 'sk_secret',
  ELEVENLABS_VOICE_ID: 'voice123',
  ALLOWED_SPOTIFY_USERS: 'edwin',
  TTS_RATE_LIMIT: '3'
};

function fakeFetch({ user = 'edwin', meStatus = 200, ttsStatus = 200 } = {}) {
  return vi.fn(async (url) => {
    if (String(url).startsWith('https://api.spotify.com/v1/me')) {
      return new Response(JSON.stringify({ id: user }), { status: meStatus });
    }
    return new Response(new Uint8Array([1, 2, 3]), { status: ttsStatus });
  });
}

const req = (over = {}) => ({
  method: 'POST',
  headers: { host: 'dj.example', origin: 'https://dj.example', authorization: 'Bearer tok', ...over.headers },
  body: over.body ?? { text: 'Hola, aquí va la siguiente.' },
  ...(over.method ? { method: over.method } : {})
});

describe('api/tts', () => {
  it('devuelve audio y la clave solo viaja a ElevenLabs', async () => {
    const fetchImpl = fakeFetch();
    const handle = createTtsHandler({ env: ENV, fetchImpl });
    const out = await handle(req());
    expect(out.status).toBe(200);
    expect(out.headers['Content-Type']).toBe('audio/mpeg');
    const [, ttsCall] = fetchImpl.mock.calls;
    expect(ttsCall[0]).toContain('api.elevenlabs.io/v1/text-to-speech/voice123');
    expect(ttsCall[1].headers['xi-api-key']).toBe('sk_secret');
    expect(JSON.parse(ttsCall[1].body).model_id).toBe('eleven_multilingual_v2');
    expect(String(out.body)).not.toContain('sk_secret');
  });

  it('503 si falta configurar la clave', async () => {
    const handle = createTtsHandler({ env: {}, fetchImpl: fakeFetch() });
    expect((await handle(req())).status).toBe(503);
  });

  it('401 sin token y con token inválido', async () => {
    const h1 = createTtsHandler({ env: ENV, fetchImpl: fakeFetch() });
    expect((await h1(req({ headers: { authorization: '' } }))).status).toBe(401);
    const h2 = createTtsHandler({ env: ENV, fetchImpl: fakeFetch({ meStatus: 401 }) });
    expect((await h2(req())).status).toBe(401);
  });

  it('403 para usuarios fuera de la lista (e informa su id)', async () => {
    const handle = createTtsHandler({ env: ENV, fetchImpl: fakeFetch({ user: 'extraño' }) });
    const out = await handle(req());
    expect(out.status).toBe(403);
    expect(JSON.parse(out.body).spotifyUserId).toBe('extraño');
  });

  it('403 desde otro origen', async () => {
    const handle = createTtsHandler({ env: ENV, fetchImpl: fakeFetch() });
    expect((await handle(req({ headers: { origin: 'https://malo.example' } }))).status).toBe(403);
  });

  it('413 si el texto es demasiado largo y 400 si falta', async () => {
    const handle = createTtsHandler({ env: ENV, fetchImpl: fakeFetch() });
    expect((await handle(req({ body: { text: 'a'.repeat(MAX_TEXT_LENGTH + 1) } }))).status).toBe(413);
    expect((await handle(req({ body: {} }))).status).toBe(400);
  });

  it('429 al superar el límite por usuario', async () => {
    const handle = createTtsHandler({ env: ENV, fetchImpl: fakeFetch() });
    for (let i = 0; i < 3; i++) expect((await handle(req())).status).toBe(200);
    expect((await handle(req())).status).toBe(429);
  });

  it('502 si ElevenLabs falla, sin filtrar detalles', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const handle = createTtsHandler({ env: ENV, fetchImpl: fakeFetch({ ttsStatus: 401 }) });
    const out = await handle(req());
    expect(out.status).toBe(502);
    expect(out.body).not.toContain('sk_secret');
  });

  it('405 para métodos distintos de POST', async () => {
    const handle = createTtsHandler({ env: ENV, fetchImpl: fakeFetch() });
    expect((await handle(req({ method: 'GET' }))).status).toBe(405);
  });
});
