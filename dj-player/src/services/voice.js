// ============================================================
// Voice — capa unificada de voz del DJ. Devuelve { speak, provider }.
// VITE_TTS_PROVIDER: 'auto' (ElevenLabs y si falla navegador),
// 'local' (siempre navegador, gratis), 'elevenlabs' (solo ElevenLabs).
// ============================================================

import { generateDJVoice } from './elevenLabsAPI.js';
import { speakLocal, localTTSAvailable } from './localTTS.js';
import { playVoiceBuffer, getAudioContext } from './audioMixer.js';

const PROVIDER = (import.meta.env.VITE_TTS_PROVIDER || 'auto').toLowerCase();
const HAS_ELEVEN = !!import.meta.env.VITE_ELEVENLABS_API_KEY && !!import.meta.env.VITE_ELEVENLABS_VOICE_ID;

export async function prepareDJVoice(text) {
  if (PROVIDER === 'elevenlabs' || (PROVIDER === 'auto' && HAS_ELEVEN)) {
    const buffer = await generateDJVoice(text, getAudioContext());
    if (buffer) return { provider: 'elevenlabs', speak: (opts) => playVoiceBuffer(buffer, opts) };
    if (PROVIDER === 'elevenlabs') return { provider: 'none', speak: async () => {} };
  }
  if (localTTSAvailable()) return { provider: 'local', speak: (opts) => speakLocal(text, opts) };
  return { provider: 'none', speak: async () => {} };
}
