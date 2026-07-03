// ============================================================
// Taste Profile — lo que el DJ SABE de tu Spotify
// ------------------------------------------------------------
// Combina tus tops de Spotify por rango de tiempo:
//   short_term  ≈ últimas 4 semanas ("estas semanas")
//   medium_term ≈ últimos 6 meses   ("últimos meses")
//   long_term   ≈ historial completo ("de siempre")
// más lo recién reproducido (conteo de repeticiones reales).
// El resultado alimenta los guiones del DJ y las recomendaciones.
// ============================================================

import { getTopTracks, getTopArtists, getRecentlyPlayed } from './spotifyAPI.js';

const safe = (p) => p.catch(() => []);

export async function buildTasteProfile() {
  const [
    topTracksWeek, topTracksMonths, topTracksAll,
    topArtistsWeek, topArtistsMonths, topArtistsAll,
    recent
  ] = await Promise.all([
    safe(getTopTracks('short_term', 30)),
    safe(getTopTracks('medium_term', 50)),
    safe(getTopTracks('long_term', 50)),
    safe(getTopArtists('short_term', 15)),
    safe(getTopArtists('medium_term', 20)),
    safe(getTopArtists('long_term', 20)),
    safe(getRecentlyPlayed(50))
  ]);

  // Conteo de repeticiones reales en lo recién escuchado
  const trackPlays = new Map();
  const artistPlays = new Map();
  recent.forEach((t) => {
    if (!t) return;
    trackPlays.set(t.id, { track: t, count: (trackPlays.get(t.id)?.count || 0) + 1 });
    const a = t.artists?.[0]?.name;
    if (a) artistPlays.set(a, (artistPlays.get(a) || 0) + 1);
  });
  const mostRepeated = [...trackPlays.values()].sort((a, b) => b.count - a.count)[0] || null;

  // Artista "en ascenso": fuerte estas semanas pero NO en tu top histórico
  const allTimeNames = new Set(topArtistsAll.map((a) => a.name));
  const rising = topArtistsWeek.find((a) => !allTimeNames.has(a.name)) || null;

  // Época favorita (moda de la década en tus tops de 6 meses)
  const decades = {};
  topTracksMonths.forEach((t) => {
    const y = Number((t.album?.release_date || '').slice(0, 4));
    if (y) {
      const d = Math.floor(y / 10) * 10;
      decades[d] = (decades[d] || 0) + 1;
    }
  });
  const favoriteDecade = Object.entries(decades).sort((a, b) => b[1] - a[1])[0]?.[0] || null;

  // Todo lo que ya conoces (para no "recomendarte" lo obvio)
  const knownTrackIds = new Set(
    [...topTracksWeek, ...topTracksMonths, ...topTracksAll, ...recent].filter(Boolean).map((t) => t.id)
  );
  const knownArtistNames = new Set(
    [...topArtistsWeek, ...topArtistsMonths, ...topArtistsAll].map((a) => a.name)
  );

  return {
    // Los datos crudos por si se necesitan
    topTracksWeek, topTracksMonths, topTracksAll,
    topArtistsWeek, topArtistsMonths, topArtistsAll,
    // Hechos que el DJ puede mencionar
    obsessionArtist: topArtistsWeek[0]?.name || null,          // tu #1 de estas semanas
    monthArtist: topArtistsMonths[0]?.name || null,            // tu #1 de los últimos meses
    allTimeArtist: topArtistsAll[0]?.name || null,             // tu #1 de siempre
    weekTopTrack: topTracksWeek[0] || null,
    risingArtist: rising?.name || null,                        // nuevo en tu radar
    mostRepeated,                                              // { track, count } reciente
    favoriteDecade: favoriteDecade ? Number(favoriteDecade) : null,
    knownTrackIds,
    knownArtistNames,
    fetchedAt: Date.now()
  };
}

/** ¿El artista de este track está entre tus más escuchados? */
export function artistRankFor(profile, track) {
  if (!profile || !track) return null;
  const name = track.artists?.[0]?.name;
  if (!name) return null;
  if (profile.topArtistsWeek.some((a) => a.name === name)) return 'semana';
  if (profile.topArtistsMonths.some((a) => a.name === name)) return 'meses';
  if (profile.topArtistsAll.some((a) => a.name === name)) return 'siempre';
  return null;
}
