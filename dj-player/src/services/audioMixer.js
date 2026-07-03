// ============================================================
// Audio Mixer — orquesta la transición estilo "DJ Livi"
// ------------------------------------------------------------
// Realidad técnica: el audio de Spotify está protegido (DRM),
// así que no podemos tocar su PCM con Web Audio API. Lo que SÍ
// podemos hacer (y es exactamente lo que hace el DJ de Spotify):
//   1. Bajar el volumen del track actual con una rampa suave
//   2. Reproducir la voz del DJ localmente (Web Audio, sin DRM)
//   3. Arrancar el siguiente track por debajo de la voz
//   4. Subir el volumen con rampa cuando la voz termina
// El "crossfade" es una coreografía de volúmenes + voz encima.
// ============================================================

let audioContext = null;

export function getAudioContext() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioContext.state === 'suspended') audioContext.resume();
  return audioContext;
}

/**
 * Reproduce el AudioBuffer de la voz DJ con fade in/out propio.
 * @returns {Promise<void>} resuelve cuando la voz termina
 */
export function playVoiceBuffer(buffer, { fadeIn = 0.15, fadeOut = 0.25, gainDb = 0 } = {}) {
  return new Promise((resolve) => {
    const ctx = getAudioContext();
    const source = ctx.createBufferSource();
    const gain = ctx.createGain();
    source.buffer = buffer;
    source.connect(gain);
    gain.connect(ctx.destination);

    const now = ctx.currentTime;
    const level = Math.pow(10, gainDb / 20);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(level, now + fadeIn);
    gain.gain.setValueAtTime(level, now + buffer.duration - fadeOut);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + buffer.duration);

    source.onended = () => resolve();
    source.start(now);
  });
}

/**
 * Rampa de volumen sobre el reproductor de Spotify.
 * Acepta cualquier función setVolume(0..1) — puede ser el
 * Web Playback SDK (suave) o la API de Connect (por pasos).
 */
export async function rampVolume(setVolume, from, to, durationMs, steps = 12) {
  const stepTime = durationMs / steps;
  for (let i = 1; i <= steps; i++) {
    // curva de igual potencia: suena más natural que lineal
    const t = i / steps;
    const value = from + (to - from) * Math.sin((t * Math.PI) / 2);
    try {
      await setVolume(Math.max(0, Math.min(1, value)));
    } catch (err) {
      console.warn('[Mixer] setVolume falló, continuando:', err.message);
    }
    await new Promise((r) => setTimeout(r, stepTime));
  }
}

/**
 * Transición completa entre dos tracks con voz DJ.
 * @param {object} params
 * @param {Function} params.setVolume  - setVolume(0..1) del player de Spotify
 * @param {Function} params.playNext   - inicia el siguiente track
 * @param {object|null} params.voice  - { speak: () => Promise } o null = solo fade
 * @param {number} params.duckLevel   - volumen bajo la voz (-3 dB ≈ 0.35)
 */
export async function performTransition({ setVolume, playNext, voice, duckLevel = 0.35 }) {
  // 1) Fade out del track actual (2 s)
  await rampVolume(setVolume, 1.0, 0.15, 2000);

  if (voice && voice.provider !== 'none') {
    // 2) Arranca el siguiente track "por debajo" de la voz
    await playNext();
    await setVolume(duckLevel);
    // 3) Voz DJ encima del intro del siguiente track
    await voice.speak();
    // 4) Sube el siguiente track a volumen normal (2 s)
    await rampVolume(setVolume, duckLevel, 1.0, 2000);
  } else {
    await playNext();
    await rampVolume(setVolume, 0.15, 1.0, 3000);
  }
}
