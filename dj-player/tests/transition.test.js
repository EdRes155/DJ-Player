import { describe, it, expect } from 'vitest';
import { performTransition, transitionLeadMs } from '../src/services/audioMixer.js';

describe('performTransition', () => {
  it('la siguiente canción arranca DESPUÉS de que el DJ termina de hablar', async () => {
    const log = [];
    await performTransition({
      setVolume: async () => {},
      playNext: async () => { log.push('playNext'); },
      voice: { provider: 'elevenlabs', speak: async () => { log.push('speak'); } }
    });
    expect(log).toEqual(['speak', 'playNext']);
  });

  it('si la sesión se cancela durante la voz, no cambia de canción', async () => {
    let active = true;
    const log = [];
    await performTransition({
      setVolume: async () => {},
      playNext: async () => { log.push('playNext'); },
      voice: { provider: 'local', speak: async () => { active = false; } },
      isActive: () => active
    });
    expect(log).toEqual([]);
  });
});

describe('transitionLeadMs', () => {
  it('da tiempo para la voz completa antes del final', () => {
    expect(transitionLeadMs({ provider: 'elevenlabs', estimatedMs: 7000 })).toBe(10000);
    expect(transitionLeadMs(null)).toBe(4000);
    expect(transitionLeadMs({ provider: 'elevenlabs', estimatedMs: 90000 })).toBe(30000);
  });
});
