// ============================================================
// Backend de TTS (ElevenLabs) — la clave NUNCA llega al navegador
// ------------------------------------------------------------
// POST /api/tts  { text }  con  Authorization: Bearer <token Spotify>
//   1. Verifica el token contra Spotify (/v1/me) → id de usuario.
//   2. Solo permite los ids de ALLOWED_SPOTIFY_USERS.
//   3. Limita longitud del texto y peticiones por usuario.
//   4. Llama a ElevenLabs con ELEVENLABS_API_KEY (secreto de servidor)
//      y devuelve audio/mpeg.
//
// Variables de entorno (Vercel → Settings → Environment Variables,
// SIN prefijo VITE_ para que no entren al bundle):
//   ELEVENLABS_API_KEY      (obligatoria)
//   ELEVENLABS_VOICE_ID     (obligatoria)
//   ELEVENLABS_MODEL_ID     (opcional, por defecto eleven_multilingual_v2)
//   ALLOWED_SPOTIFY_USERS   (obligatoria: ids de Spotify separados por coma)
//   TTS_ALLOWED_ORIGINS     (opcional: orígenes extra, p. ej. de Electron)
//   TTS_RATE_LIMIT          (opcional: peticiones por usuario cada 10 min, 60)
// ============================================================

export const MAX_TEXT_LENGTH = 600;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const AUTH_CACHE_MS = 5 * 60 * 1000;
const UPSTREAM_TIMEOUT_MS = 20000;

const list = (v) => String(v || '').split(',').map((s) => s.trim()).filter(Boolean);

function voiceSettingsFor(model) {
  // Eleven v3 solo acepta stability 0 / 0.5 / 1 y menos parámetros
  if (model.startsWith('eleven_v3')) return { stability: 0.5, similarity_boost: 0.8 };
  return {
    stability: 0.45,        // un poco de variación = más humano
    similarity_boost: 0.8,
    style: 0.35,            // energía de locutor sin exagerar
    use_speaker_boost: true
  };
}

export function createTtsHandler({ env = process.env, fetchImpl = fetch, now = Date.now } = {}) {
  const authCache = new Map();   // token → { id, exp }
  const hits = new Map();        // userId → [timestamps]

  const allowedOrigin = (origin, host) => {
    if (!origin) return true; // misma página (algunos navegadores no envían Origin)
    try {
      if (new URL(origin).host === host) return true;
    } catch { /* "null" u origen inválido */ }
    return list(env.TTS_ALLOWED_ORIGINS).includes(origin);
  };

  async function spotifyUser(token) {
    const cached = authCache.get(token);
    if (cached && cached.exp > now()) return cached.id;
    const res = await fetchImpl('https://api.spotify.com/v1/me', {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const me = await res.json();
    if (!me?.id) return null;
    if (authCache.size > 500) authCache.clear();
    authCache.set(token, { id: me.id, exp: now() + AUTH_CACHE_MS });
    return me.id;
  }

  function rateLimited(userId) {
    const limit = Number(env.TTS_RATE_LIMIT) || 60;
    const t = now();
    const recent = (hits.get(userId) || []).filter((x) => t - x < RATE_WINDOW_MS);
    if (recent.length >= limit) { hits.set(userId, recent); return true; }
    recent.push(t);
    hits.set(userId, recent);
    return false;
  }

  /**
   * @param {{ method: string, headers: Record<string,string>, body: any }} req
   * @returns {Promise<{ status: number, headers: object, body: any }>}
   */
  return async function handle(req) {
    const origin = req.headers.origin;
    const host = req.headers['x-forwarded-host'] || req.headers.host;
    const baseHeaders = { 'Cache-Control': 'no-store', Vary: 'Origin, Authorization' };
    if (origin && allowedOrigin(origin, host)) {
      baseHeaders['Access-Control-Allow-Origin'] = origin;
      baseHeaders['Access-Control-Allow-Headers'] = 'Authorization, Content-Type';
      baseHeaders['Access-Control-Allow-Methods'] = 'POST, OPTIONS';
    }
    const json = (status, data) => ({
      status, headers: { ...baseHeaders, 'Content-Type': 'application/json' }, body: JSON.stringify(data)
    });

    if (req.method === 'OPTIONS') return { status: 204, headers: baseHeaders, body: '' };
    if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });
    if (!allowedOrigin(origin, host)) return json(403, { error: 'origin_not_allowed' });

    if (!env.ELEVENLABS_API_KEY || !env.ELEVENLABS_VOICE_ID) {
      return json(503, { error: 'tts_not_configured' });
    }
    const allowedUsers = list(env.ALLOWED_SPOTIFY_USERS);
    if (!allowedUsers.length) return json(503, { error: 'allowlist_not_configured' });

    const auth = req.headers.authorization || '';
    const token = auth.startsWith('Bearer ') ? auth.slice(7).trim() : '';
    if (!token) return json(401, { error: 'missing_token' });

    let userId;
    try {
      userId = await spotifyUser(token);
    } catch {
      return json(502, { error: 'spotify_unreachable' });
    }
    if (!userId) return json(401, { error: 'invalid_token' });
    // Se devuelve el id para que el dueño sepa qué poner en la lista
    if (!allowedUsers.includes(userId)) return json(403, { error: 'user_not_allowed', spotifyUserId: userId });
    if (rateLimited(userId)) return json(429, { error: 'rate_limited' });

    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch { body = null; }
    }
    const text = typeof body?.text === 'string' ? body.text.trim() : '';
    if (!text) return json(400, { error: 'missing_text' });
    if (text.length > MAX_TEXT_LENGTH) return json(413, { error: 'text_too_long', max: MAX_TEXT_LENGTH });

    const model = env.ELEVENLABS_MODEL_ID || 'eleven_multilingual_v2';
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
    try {
      const res = await fetchImpl(
        `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(env.ELEVENLABS_VOICE_ID)}?output_format=mp3_44100_128`,
        {
          method: 'POST',
          signal: controller.signal,
          headers: {
            'xi-api-key': env.ELEVENLABS_API_KEY,
            'Content-Type': 'application/json',
            Accept: 'audio/mpeg'
          },
          body: JSON.stringify({ text, model_id: model, voice_settings: voiceSettingsFor(model) })
        }
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        console.error('[tts] ElevenLabs respondió', res.status, detail.slice(0, 300));
        return json(502, { error: 'tts_upstream_error', upstreamStatus: res.status });
      }
      const audio = Buffer.from(await res.arrayBuffer());
      return { status: 200, headers: { ...baseHeaders, 'Content-Type': 'audio/mpeg' }, body: audio };
    } catch (err) {
      console.error('[tts] Error llamando a ElevenLabs:', err?.name || err);
      return json(504, { error: 'tts_timeout' });
    } finally {
      clearTimeout(timer);
    }
  };
}
