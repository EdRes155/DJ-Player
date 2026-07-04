// ============================================================
// Local TTS — la voz del DJ usando el navegador (gratis)
// Usa la Web Speech API (speechSynthesis). Sin API key, offline,
// y en Windows trae voces en español nativas. Expone speak().
// ============================================================

let cachedVoice = null;

function loadVoices() {
  return new Promise((resolve) => {
    const voices = speechSynthesis.getVoices();
    if (voices.length) return resolve(voices);
    speechSynthesis.onvoiceschanged = () => resolve(speechSynthesis.getVoices());
  });
}

async function pickSpanishVoice() {
  if (cachedVoice) return cachedVoice;
  const voices = await loadVoices();
  cachedVoice =
    voices.find((v) => /es[-_]MX/i.test(v.lang)) ||
    voices.find((v) => /es[-_]US/i.test(v.lang)) ||
    voices.find((v) => /^es/i.test(v.lang)) ||
    voices[0] || null;
  return cachedVoice;
}

export function localTTSAvailable() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
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
    const done = () => { clearInterval(keepAlive); resolve(); };
    utter.onstart = () => onStart?.();
    utter.onend = done;
    utter.onerror = done;
    speechSynthesis.cancel();
    speechSynthesis.speak(utter);
  });
}

export function stopLocal() {
  if (localTTSAvailable()) speechSynthesis.cancel();
}
