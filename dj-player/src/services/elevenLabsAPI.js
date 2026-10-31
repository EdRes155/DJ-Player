// ============================================================
// ElevenLabs TTS — la voz del DJ
// La clave de ElevenLabs vive SOLO en el servidor (api/tts.js).
// El navegador manda el guion + su token de Spotify al backend
// y recibe el MP3. Devuelve un AudioBuffer listo para el audioMixer.
// ============================================================

import { getAccessToken } from './spotifyAPI.js';

// En la web: misma origin. En Electron (file://) usa la URL absoluta del deploy.
const ENDPOINT = import.meta.env.VITE_TTS_ENDPOINT || '/api/tts';
const REQUEST_TIMEOUT_MS = 15000;
const CACHE_MAX = 40;

// Cache en memoria para no pagar dos veces el mismo guion
const voiceCache = new Map();
// Si el backend dice que no está configurado, no insistimos en esta sesión
let disabledReason = null;

export function elevenLabsDisabled() {
  return disabledReason;
}

/**
 * Genera la voz del DJ a partir de un guion.
 * @param {string} text - Guion generado por djScript.js
 * @param {AudioContext} audioContext - Contexto para decodificar
 * @returns {Promise<AudioBuffer|null>} null = usar otra voz / sin voz
 */
export async function generateDJVoice(text, audioContext) {
  if (disabledReason) return null;
  if (voiceCache.has(text)) return voiceCache.get(text);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const token = await getAccessToken();
    if (!token) return null;
    const res = await fetch(ENDPOINT, {
      method: 'POST',
      signal: controller.signal,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
    if (!res.ok) {
      const info = await res.json().catch(() => ({}));
      if (res.status === 503 || res.status === 403 || res.status === 404) {
        disabledReason = info.error || `http_${res.status}`;
        if (info.spotifyUserId) {
          console.warn(`[ElevenLabs] Tu usuario de Spotify (${info.spotifyUserId}) no está en ALLOWED_SPOTIFY_USERS.`);
        }
      }
      throw new Error(`TTS ${res.status} ${info.error || ''}`.trim());
    }
    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    if (voiceCache.size >= CACHE_MAX) voiceCache.delete(voiceCache.keys().next().value);
    voiceCache.set(text, audioBuffer);
    return audioBuffer;
  } catch (err) {
    console.warn('[ElevenLabs] Sin voz premium para este guion:', err.message || err);
    return null; // la transición sigue funcionando (voz local o solo fades)
  } finally {
    clearTimeout(timer);
  }
}
