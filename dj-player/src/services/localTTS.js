// ============================================================
// Local TTS — la voz del DJ usando el navegador (gratis)
// Usa la Web Speech API (speechSynthesis). Sin API key, offline,
// y en Windows trae voces en español nativas. Expone speak().
// Nunca se queda colgada: si no hay voces o el motor no responde,
// resuelve por timeout y el DJ sigue sin voz.
// ============================================================

const VOICES_TIMEOUT_MS = 1500;
let cachedVoice = null;

function loadVoices() {
  return new Promise((resolve) => {
    const voices = speechSynthesis.getVoices();
    if (voices.length) return resolve(voices);
    const finish = () => {
      clearTimeout(timer);
      speechSynthesis.removeEventListener?.('voiceschanged', finish);
      resolve(speechSynthesis.getVoices());
    };
    const timer = setTimeout(finish, VOICES_TIMEOUT_MS);
    speechSynthesis.addEventListener?.('voiceschanged', finish);
  });
}

async function pickSpanishVoice() {
  if (cachedVoice) return cachedVoice;
  const voices = await loadVoices();
  const voice =
    voices.find((v) => /es[-_]MX/i.test(v.lang)) ||
    voices.find((v) => /es[-_]US/i.test(v.lang)) ||
    voices.find((v) => /^es/i.test(v.lang)) ||
    voices[0] || null;
  if (voice) cachedVoice = voice; // si no hubo voces, se reintenta la próxima vez
  return voice;
}

export function localTTSAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// Tiempo máximo razonable para decir un texto (≈ 12 caracteres/s + margen)
export function maxSpeechMs(text, rate = 1) {
  return Math.max(6000, (text.length / 12 / rate) * 1000 + 4000);
}

export async function speakLocal(text, { rate = 1.02, pitch = 1.0, onStart } = {}) {
  if (!localTTSAvailable()) return;
  const voice = await pickSpanishVoice();
  return new Promise((resolve) => {
    const utter = new SpeechSynthesisUtterance(text);
    if (voice) { utter.voice = voice; utter.lang = voice.lang; }
    else utter.lang = 'es-MX';
    utter.rate = rate;
    utter.pitch = pitch;
    // Chrome pausa utterances largos (~15 s); un resume periódico lo evita
    const keepAlive = setInterval(() => {
      try { if (speechSynthesis.speaking) speechSynthesis.resume(); } catch { /* nada */ }
    }, 5000);
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      clearInterval(keepAlive);
      clearTimeout(guard);
      resolve();
    };
    // Si onend/onerror nunca llegan (motor trabado), no bloqueamos al DJ
    const guard = setTimeout(() => {
      try { speechSynthesis.cancel(); } catch { /* nada */ }
      done();
    }, maxSpeechMs(text, rate));
    utter.onstart = () => onStart?.();
    utter.onend = done;
    utter.onerror = done;
    try {
      speechSynthesis.cancel();
      speechSynthesis.speak(utter);
    } catch {
      done();
    }
  });
}

export function stopLocal() {
  if (localTTSAvailable()) speechSynthesis.cancel();
}
