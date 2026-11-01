// ============================================================
// DJ Engine — la inteligencia del set
// ------------------------------------------------------------
// Como /audio-features y /recommendations están deprecados para
// apps nuevas, la energía se INFIERE de señales disponibles:
// géneros del artista, popularidad, año y duración. Si tu app
// tiene acceso legacy, tryGetAudioFeatures() mejora el análisis.
// ============================================================

import { getTopArtists, getTopTracks, getArtists, searchTracks, tryGetAudioFeatures, getArtistAlbums, getAlbumTracks } from './spotifyAPI.js';

// Géneros -> energía estimada (0..1) y "mood" para el guion del DJ
const GENRE_PROFILES = [
  { match: /reggaeton|perreo|dembow|urbano/, energy: 0.9, mood: 'fiesta' },
  { match: /edm|electro|house|techno|dance|dubstep|trance/, energy: 0.88, mood: 'fiesta' },
  { match: /metal|hardcore|punk/, energy: 0.85, mood: 'intenso' },
  { match: /rock|grunge|alternative/, energy: 0.7, mood: 'intenso' },
  { match: /hip.?hop|rap|trap/, energy: 0.72, mood: 'flow' },
  { match: /pop|k-pop|latin pop/, energy: 0.65, mood: 'fiesta' },
  { match: /banda|norte|corrido|regional|mariachi|cumbia|salsa/, energy: 0.68, mood: 'fiesta' },
  { match: /indie|folk|singer-songwriter/, energy: 0.45, mood: 'chill' },
  { match: /r&b|soul|funk/, energy: 0.55, mood: 'flow' },
  { match: /jazz|bossa|blues/, energy: 0.4, mood: 'chill' },
  { match: /lo-?fi|ambient|chill|sleep|acoustic/, energy: 0.25, mood: 'chill' },
  { match: /classical|piano|instrumental/, energy: 0.2, mood: 'chill' }
];

// Categorías que el usuario puede elegir en la UI (GenreSelector)
export const VIBE_PRESETS = [
  { id: 'auto', label: 'Automático', query: null },
  { id: 'fiesta', label: 'Fiesta', query: /reggaeton|edm|dance|pop|cumbia|house/ },
  { id: 'chill', label: 'Chill', query: /indie|lo-?fi|acoustic|chill|folk|jazz|r&b/ },
  { id: 'intenso', label: 'Rock / Intenso', query: /rock|metal|punk|alternative/ },
  { id: 'flow', label: 'Hip-Hop / Flow', query: /hip.?hop|rap|trap|r&b|funk/ },
  { id: 'regional', label: 'Regional / Latino', query: /banda|corrido|norte|regional|cumbia|salsa|mariachi/ }
];

// Consultas de búsqueda por vibra: construyen un set REAL aunque los
// géneros del artista den 403. Mezclan filtros de género de Spotify
// (genre:"...", más precisos) con palabras clave. Cada vibra suena distinta.
export const VIBE_SEARCH_QUERIES = {
  fiesta: [
    'genre:reggaeton', 'genre:"urbano latino"', 'genre:dance', 'genre:edm', 'genre:"latin pop"',
    'genre:house', 'perreo', 'fiesta latina', 'dance hits', 'cumbia sonidera'
  ],
  chill: [
    'genre:"lo-fi"', 'genre:"chill pop"', 'genre:"bossa nova"', 'genre:acoustic', 'genre:"indie folk"',
    'genre:"neo soul"', 'lofi chill', 'indie chill español', 'acoustic covers', 'r&b chill'
  ],
  intenso: [
    'genre:rock', 'genre:"hard rock"', 'genre:metal', 'genre:"punk rock"', 'genre:"rock en espanol"',
    'genre:"alternative rock"', 'rock en español', 'rock clásico', 'rock alternativo'
  ],
  flow: [
    'genre:"hip hop"', 'genre:rap', 'genre:trap', 'genre:"trap latino"', 'genre:"boom bap"',
    'genre:"rap latina"', 'rap español', 'hip hop clásico', 'freestyle'
  ],
  regional: [
    'genre:"corrido"', 'genre:"corridos tumbados"', 'genre:banda', 'genre:norteno', 'genre:"regional mexican"',
    'genre:mariachi', 'genre:cumbia', 'corridos tumbados', 'banda mx', 'norteñas'
  ]
};

// Spotify limita la búsqueda a 10 resultados por página: pedimos varias
// consultas con desplazamientos aleatorios para tener variedad.
const SEARCH_PAGE = 10;

// Fisher-Yates: baraja sin sesgo (para que no salga lo mismo cada vez)
export function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Construye un pool de canciones para una vibra específica buscando
 * en el catálogo de Spotify. Varía cada vez (baraja consultas y resultados).
 */
export async function buildVibeSet(vibeId, { limit = 30 } = {}) {
  const queries = VIBE_SEARCH_QUERIES[vibeId];
  if (!queries) return [];
  const pool = [];
  const perArtist = {};
  const add = (t) => {
    const artist = t?.artists?.[0]?.id;
    if (!t?.uri || !artist) return;
    // Máximo 2 por artista: que la vibra no sea un solo cantante
    perArtist[artist] = (perArtist[artist] || 0) + 1;
    if (perArtist[artist] <= 2) pool.push(t);
  };
  const runs = shuffle(queries).slice(0, 7).map(async (q) => {
    // Primera página o una más profunda, para no repetir siempre los mismos hits
    const offset = Math.random() < 0.5 ? 0 : SEARCH_PAGE * (1 + Math.floor(Math.random() * 3));
    try {
      let found = await searchTracks(q, SEARCH_PAGE, offset);
      if (!found.length && offset) found = await searchTracks(q, SEARCH_PAGE, 0);
      return found;
    } catch (err) {
      console.warn('[DJ Engine] búsqueda de vibra falló:', q, err.message);
      return [];
    }
  });
  (await Promise.all(runs)).flat().forEach(add);
  const seen = new Set();
  const unique = pool.filter((t) => !seen.has(t.id) && seen.add(t.id));
  return shuffle(unique).slice(0, limit);
}

/** ¿El track encaja con la vibra? true/false si hay géneros, null si no se sabe. */
export function matchesVibe(track, vibeId) {
  const vibe = VIBE_PRESETS.find((v) => v.id === vibeId);
  if (!vibe?.query) return true;
  const genres = track.dj?.genres || [];
  if (!genres.length) return null;
  return vibe.query.test(genres.join(' '));
}

/** Enriquece tracks con energia, mood y generos del artista. */
export async function analyzeTracks(tracks) {
  const artistIds = [...new Set(tracks.map((t) => t.artists?.[0]?.id).filter(Boolean))];
  const genreByArtist = {};
  try {
    for (let i = 0; i < artistIds.length; i += 50) {
      const artists = await getArtists(artistIds.slice(i, i + 50));
      artists.forEach((a) => { if (a) genreByArtist[a.id] = a.genres || []; });
    }
  } catch (err) {
    console.warn('[DJ Engine] No pude leer géneros:', err.message);
  }

  // Bonus: audio features reales si la app tiene acceso legacy
  const features = await tryGetAudioFeatures(tracks.map((t) => t.id));
  const featById = Object.fromEntries(features.filter(Boolean).map((f) => [f.id, f]));

  return tracks.map((track) => {
    const genres = genreByArtist[track.artists?.[0]?.id] || [];
    const genreText = genres.join(' ');
    const profile = GENRE_PROFILES.find((p) => p.match.test(genreText));
    const feat = featById[track.id];

    const energy = feat?.energy ?? (
      (profile?.energy ?? 0.5) * 0.7 + (track.popularity ?? 50) / 100 * 0.3
    );

    return {
      ...track,
      dj: {
        genres,
        energy: Number(energy.toFixed(2)),
        mood: profile?.mood ?? 'flow',
        bpm: feat?.tempo ? Math.round(feat.tempo) : null,
        key: feat?.key ?? null,
        year: Number((track.album?.release_date || '').slice(0, 4)) || null
      }
    };
  });
}

/**
 * Reordena la cola como un set de DJ real:
 * arranca medio, construye energía, clímax al 70% y baja al final.
 */
export function reorderQueue(analyzedTracks) {
  const sorted = [...analyzedTracks].sort((a, b) => a.dj.energy - b.dj.energy);
  const n = sorted.length;
  if (n < 4) return sorted;

  const arc = [];
  const low = shuffle(sorted.slice(0, Math.ceil(n * 0.3)));
  const mid = shuffle(sorted.slice(Math.ceil(n * 0.3), Math.ceil(n * 0.7)));
  const high = shuffle(sorted.slice(Math.ceil(n * 0.7)));

  arc.push(...mid.slice(0, Math.ceil(mid.length / 2))); // apertura media
  arc.push(...high);                                     // clímax
  arc.push(...mid.slice(Math.ceil(mid.length / 2)));     // bajada
  arc.push(...low);                                      // cierre suave
  return arc;
}

/** Qué tan compatible es pasar de A a B (para el guion del DJ). */
export function calculateTransition(trackA, trackB) {
  if (!trackA || !trackB) return { score: 1, type: 'apertura' };
  const dE = trackB.dj.energy - trackA.dj.energy;
  const sameArtist = trackA.artists?.[0]?.id === trackB.artists?.[0]?.id;
  const sharedGenre = trackA.dj.genres.some((g) => trackB.dj.genres.includes(g));
  let type = 'lateral';
  if (dE > 0.15) type = 'subida';
  else if (dE < -0.15) type = 'bajada';
  if (sameArtist) type = 'mismo-artista';
  const score = 1 - Math.abs(dE) + (sharedGenre ? 0.2 : 0);
  return { score: Number(score.toFixed(2)), type, sameArtist, sharedGenre, deltaEnergy: dE };
}

/**
 * Recomendaciones RAZONADAS a partir del perfil de escucha.
 * Cada track sugerido trae .recReason con el porqué, para que el DJ
 * lo explique al presentarla. Mezcla tres tipos:
 *   1. Canciones que no conoces de artistas que SÍ escuchas mucho
 *   2. Tracks del álbum más reciente de tu artista del momento
 *   3. Artistas nuevos para ti, del mismo terreno que tus favoritos
 */
export async function getRecommendations({ vibeId = 'auto', limit = 15, profile = null } = {}) {
  try {
    // Sin perfil, cae al comportamiento básico con tops de 6 meses
    const weekArtists = profile?.topArtistsWeek?.length
      ? profile.topArtistsWeek
      : await getTopArtists('short_term', 10).catch(() => []);
    const monthArtists = profile?.topArtistsMonths?.length
      ? profile.topArtistsMonths
      : await getTopArtists('medium_term', 15).catch(() => []);
    const knownIds = profile?.knownTrackIds
      ?? new Set((await getTopTracks('medium_term', 50).catch(() => [])).map((t) => t.id));

    const vibe = VIBE_PRESETS.find((v) => v.id === vibeId);
    const inVibe = (a) => !vibe?.query || vibe.query.test((a.genres || []).join(' '));

    // Semillas: primero tu momento actual (semana), luego los meses.
    // Con una vibra elegida SOLO valen tus artistas de esa vibra; si no
    // tienes ninguno, los descubrimientos salen de la vibra misma.
    let seeds = [...weekArtists.filter(inVibe), ...monthArtists.filter(inVibe)];
    if (!seeds.length && !vibe?.query) seeds = [...weekArtists, ...monthArtists];
    const seen = new Set();
    seeds = seeds.filter((a) => a && !seen.has(a.name) && seen.add(a.name));

    const picked = [];
    const usedIds = new Set();
    const take = (t, reason) => {
      if (t && t.uri && !usedIds.has(t.id) && !knownIds.has(t.id)) {
        usedIds.add(t.id);
        picked.push({ ...t, isRecommendation: true, recReason: reason });
      }
    };

    // 1) Cortes que no conoces de tus artistas del momento
    for (const artist of shuffle(seeds.slice(0, 6)).slice(0, 3)) {
      try {
        const found = await searchTracks(`artist:"${artist.name}"`, SEARCH_PAGE);
        shuffle(found).slice(0, 2).forEach((t) =>
          take(t, `porque ${artist.name} está entre lo que más escuchas`));
      } catch { /* siguiente semilla */ }
    }

    // 2) El álbum más reciente de tu artista del momento
    const momentArtist = seeds[0];
    if (momentArtist?.id) {
      try {
        const albums = await getArtistAlbums(momentArtist.id, 5);
        const newest = albums?.[0];
        if (newest) {
          const albumTracks = await getAlbumTracks(newest.id);
          shuffle(albumTracks).slice(0, 2).forEach((t) =>
            take(t, `del álbum "${newest.name}" de ${momentArtist.name}`));
        }
      } catch { /* sin álbum, no pasa nada */ }
    }

    // 3) Artistas NUEVOS para ti, cercanos a tu terreno
    const knownNames = profile?.knownArtistNames ?? new Set(seeds.map((a) => a.name));
    const genreSeeds = seeds.flatMap((a) => a.genres || []).filter((g) => !vibe?.query || vibe.query.test(g)).slice(0, 3);
    const vibeQueries = VIBE_SEARCH_QUERIES[vibeId];
    const genreQueries = genreSeeds.length
      ? genreSeeds.map((g) => `genre:"${g}"`)
      : (vibeQueries || VIBE_SEARCH_QUERIES.flow);
    // Sin semillas propias en esta vibra, todos los descubrimientos son nuevos
    const rounds = seeds.length ? 2 : 4;
    for (const q of shuffle(genreQueries).slice(0, rounds)) {
      try {
        const found = await searchTracks(q, SEARCH_PAGE);
        const fresh = found.filter((t) => t.artists?.[0]?.name && !knownNames.has(t.artists[0].name));
        shuffle(fresh).slice(0, 2).forEach((t) =>
          take(t, `artista nuevo para ti: ${t.artists[0].name}`));
      } catch { /* siguiente */ }
    }

    return shuffle(picked).slice(0, limit);
  } catch (err) {
    console.error('[DJ Engine] Error en recomendaciones:', err);
    return [];
  }
}

/**
 * Filtra tracks analizados por la vibra elegida.
 * strict=true: solo los que CONFIRMAN la vibra por género (para tu propia
 * música, que puede ser de cualquier estilo). strict=false: descarta solo
 * los que la contradicen y conserva los de género desconocido (para los
 * resultados de búsqueda de la vibra, que ya vienen filtrados por Spotify).
 */
export function filterByVibe(analyzedTracks, vibeId, { strict = false } = {}) {
  const vibe = VIBE_PRESETS.find((v) => v.id === vibeId);
  if (!vibe || !vibe.query) return analyzedTracks;
  return analyzedTracks.filter((t) => {
    const m = matchesVibe(t, vibeId);
    return strict ? m === true : m !== false;
  });
}
