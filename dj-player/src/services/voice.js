// ============================================================
// Voice — capa unificada de voz del DJ. Devuelve { speak, provider }.
// VITE_TTS_PROVIDER: 'auto' (ElevenLabs vía backend y si falla navegador),
// 'local' (siempre navegador, gratis), 'elevenlabs' (solo ElevenLabs).
// speak() siempre termina: lleva un tope de tiempo para no dejar la
// música con el volumen bajo si algo se traba.
// ============================================================

import { generateDJVoice } from './elevenLabsAPI.js';
import { speakLocal, stopLocal, localTTSAvailable, maxSpeechMs } from './localTTS.js';
import { playVoiceBuffer, stopVoicePlayback, getAudioContext } from './audioMixer.js';

const PROVIDER = (import.meta.env.VITE_TTS_PROVIDER || 'auto').toLowerCase();

/** Corta cualquier voz del DJ que esté sonando (local o ElevenLabs). */
export function stopAnyVoice() {
  stopLocal();
  stopVoicePlayback();
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    Promise.resolve(promise).finally(() => clearTimeout(timer)),
    new Promise((resolve) => {
      timer = setTimeout(() => { stopAnyVoice(); resolve(); }, ms);
    })
  ]);
}

const SILENT = { provider: 'none', speak: async () => {} };

export async function prepareDJVoice(text) {
  if (!text) return SILENT;
  try {
    if (PROVIDER === 'elevenlabs' || PROVIDER === 'auto') {
      const buffer = await generateDJVoice(text, getAudioContext());
      if (buffer) {
        const limit = buffer.duration * 1000 + 3000;
        return {
          provider: 'elevenlabs',
          estimatedMs: buffer.duration * 1000,
          speak: (opts) => withTimeout(playVoiceBuffer(buffer, opts), limit)
        };
      }
      if (PROVIDER === 'elevenlabs') return SILENT;
    }
    if (localTTSAvailable()) {
      return {
        provider: 'local',
        estimatedMs: (text.length / 14) * 1000, // ~14 caracteres por segundo
        speak: (opts) => withTimeout(speakLocal(text, opts), maxSpeechMs(text) + 2000)
      };
    }
  } catch (err) {
    console.warn('[Voice] No pude preparar la voz:', err.message || err);
  }
  return SILENT;
}
