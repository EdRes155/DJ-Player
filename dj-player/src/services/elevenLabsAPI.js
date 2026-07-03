// ============================================================
// ElevenLabs TTS — la voz del DJ
// Devuelve un AudioBuffer listo para el audioMixer.
// ============================================================

const API_KEY = import.meta.env.VITE_ELEVENLABS_API_KEY;
const VOICE_ID = import.meta.env.VITE_ELEVENLABS_VOICE_ID;
const BASE = 'https://api.elevenlabs.io/v1';

// Cache en memoria para no pagar dos veces el mismo guion
const voiceCache = new Map();

/**
 * Genera la voz del DJ a partir de un guion.
 * @param {string} text - Guion generado por djScript.js
 * @param {AudioContext} audioContext - Contexto para decodificar
 * @returns {Promise<AudioBuffer|null>}
 */
export async function generateDJVoice(text, audioContext) {
  if (!API_KEY || !VOICE_ID) {
    console.warn('[ElevenLabs] Sin API key: el DJ será silencioso (solo fades).');
    return null;
  }
  if (voiceCache.has(text)) return voiceCache.get(text);

  try {
    const res = await fetch(`${BASE}/text-to-speech/${VOICE_ID}?output_format=mp3_44100_128`, {
      method: 'POST',
      headers: {
        'xi-api-key': API_KEY,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        text,
        model_id: 'eleven_multilingual_v2', // soporta español natural
        voice_settings: {
          stability: 0.45,        // un poco de variación = más humano
          similarity_boost: 0.8,
          style: 0.35,            // energía de locutor sin exagerar
          use_speaker_boost: true
        }
      })
    });
    if (!res.ok) throw new Error(`ElevenLabs ${res.status}`);
    const arrayBuffer = await res.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
    voiceCache.set(text, audioBuffer);
    return audioBuffer;
  } catch (err) {
    console.error('[ElevenLabs] Error generando voz:', err);
    return null; // la transición sigue funcionando sin voz
  }
}
