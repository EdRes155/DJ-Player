import { describe, it, expect, vi, afterEach } from 'vitest';

afterEach(() => {
  vi.useRealTimers();
  vi.resetModules();
  delete globalThis.window;
  delete globalThis.speechSynthesis;
  delete globalThis.SpeechSynthesisUtterance;
});

function installSynth({ voices = [], fireEnd = false } = {}) {
  const synth = {
    speaking: false,
    getVoices: () => voices,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    cancel: vi.fn(),
    resume: vi.fn(),
    speak: vi.fn((u) => { if (fireEnd) setTimeout(() => u.onend?.(), 10); })
  };
  globalThis.speechSynthesis = synth;
  globalThis.window = { speechSynthesis: synth };
  globalThis.SpeechSynthesisUtterance = class { constructor(text) { this.text = text; } };
  return synth;
}

describe('localTTS', () => {
  it('F07: sin voces y sin voiceschanged, speakLocal termina por timeout', async () => {
    vi.useFakeTimers();
    const synth = installSynth({ voices: [] });
    const { speakLocal, maxSpeechMs } = await import('../src/services/localTTS.js');

    let done = false;
    const p = speakLocal('Hola, esto es el DJ').then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(1500 + maxSpeechMs('Hola, esto es el DJ', 1.02) + 50);
    await p;
    expect(done).toBe(true);
    expect(synth.cancel).toHaveBeenCalled();
  });

  it('resuelve normalmente cuando el motor emite onend', async () => {
    vi.useFakeTimers();
    installSynth({ voices: [{ lang: 'es-MX', name: 'MX' }], fireEnd: true });
    const { speakLocal } = await import('../src/services/localTTS.js');
    const p = speakLocal('Hola');
    await vi.advanceTimersByTimeAsync(20);
    await expect(p).resolves.toBeUndefined();
  });
});
