import { describe, it, expect } from 'vitest';
import { filterByVibe, matchesVibe } from '../src/services/djEngine.js';

const t = (id, genres) => ({ id, dj: { genres } });
const tracks = [
  t('perreo', ['reggaeton', 'urbano latino']),
  t('balada', ['latin ballad']),
  t('rock', ['rock en espanol']),
  t('sin-genero', [])
];

describe('vibras', () => {
  it('matchesVibe distingue sí / no / desconocido', () => {
    expect(matchesVibe(tracks[0], 'fiesta')).toBe(true);
    expect(matchesVibe(tracks[2], 'fiesta')).toBe(false);
    expect(matchesVibe(tracks[3], 'fiesta')).toBeNull();
  });

  it('modo estricto (tu música): solo lo que confirma la vibra', () => {
    expect(filterByVibe(tracks, 'fiesta', { strict: true }).map((x) => x.id)).toEqual(['perreo']);
  });

  it('modo normal (búsqueda de la vibra): descarta solo lo que la contradice', () => {
    expect(filterByVibe(tracks, 'fiesta').map((x) => x.id)).toEqual(['perreo', 'sin-genero']);
  });

  it('automático no filtra nada', () => {
    expect(filterByVibe(tracks, 'auto')).toHaveLength(4);
  });
});
