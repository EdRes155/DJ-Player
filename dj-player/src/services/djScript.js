// ============================================================
// DJ Script — el guion que dice el DJ entre CADA canción
// ------------------------------------------------------------
// Personalidad: un DJ que CONOCE tu Spotify. Chill, cercano y
// buena onda, sin exceso de jerga. Habla con datos reales de tu
// perfil de escucha (tasteProfile): tu artista de estas semanas,
// tu #1 de siempre, lo que has repetido, tu época favorita.
// Las recomendaciones llegan con su porqué (recReason).
// Nunca repite la misma frase dos veces seguidas.
// ============================================================

const LLM_URL = import.meta.env.VITE_LLM_API_URL;
const usedTemplates = new Set();

const OPENERS = {
  madrugada: ['Sesión de madrugada, de las buenas', 'A esta hora la música se siente distinto', 'Para los que seguimos despiertos'],
  manana: ['Buenos días, empecemos bien', 'Música para arrancar el día', 'Primera hora, buena selección'],
  tarde: ['La tarde pide música', 'Buen momento para esto', 'Seguimos con la tarde'],
  noche: ['La noche apenas comienza', 'Esta hora es la mejor para escuchar', 'Modo noche, sube un poco el volumen']
};

// Presentaciones por tipo de transición (tono chill, sin jerga pesada)
const BY_TYPE = {
  subida: [
    (t) => `Vamos a subirle un poco. ${t.artist} con "${t.name}".`,
    (t) => `Esto se pone mejor: "${t.name}", de ${t.artist}.`,
    (t) => `Cambio de energía, para arriba. Aquí va ${t.artist} con "${t.name}".`
  ],
  bajada: [
    (t) => `Bajemos un poco el ritmo. Esto es "${t.name}" de ${t.artist}.`,
    (t) => `Un respiro. ${t.artist} con "${t.name}".`,
    (t) => `Algo más tranquilo ahora: "${t.name}", de ${t.artist}.`
  ],
  lateral: [
    (t) => `Seguimos en esta vibra. ${t.artist}, "${t.name}".`,
    (t) => `Esta va bien justo aquí: "${t.name}" de ${t.artist}.`,
    (t) => `Sin cambiar el ánimo, escucha "${t.name}" de ${t.artist}.`
  ],
  'mismo-artista': [
    (t) => `Nos quedamos con ${t.artist} un rato más. Ahora "${t.name}".`,
    (t) => `Otra de ${t.artist}, porque una no era suficiente: "${t.name}".`,
    (t) => `Seguimos con ${t.artist}. Esta es "${t.name}".`
  ],
  apertura: [
    (t) => `Armé este set pensando en lo que has estado escuchando. Abrimos con ${t.artist} y "${t.name}".`,
    (t) => `Ponte cómodo, yo me encargo. Primera del set: "${t.name}" de ${t.artist}.`,
    (t) => `Revisé tu música y creo que esto te va a gustar. Empezamos con "${t.name}", de ${t.artist}.`
  ]
};

// Presentación de recomendaciones: usa el porqué real (recReason)
const REC_WITH_REASON = [
  (t, reason) => `Esta te la recomiendo ${reason}. Escucha "${t.name}", de ${t.artist}.`,
  (t, reason) => `Apunta esta: "${t.name}" de ${t.artist}. Te la pongo ${reason}.`,
  (t, reason) => `Creo que va contigo, ${reason}: "${t.name}", de ${t.artist}.`
];
const REC_GENERIC = [
  (t) => `Esta no la tienes en tu rotación, pero encaja con lo tuyo: "${t.name}" de ${t.artist}.`,
  (t) => `Descubrimiento del set: ${t.artist} con "${t.name}".`
];

// Comentarios que demuestran que el DJ conoce tu Spotify
const PROFILE_LINES = {
  obsession: (name) => [
    `Por cierto, ${name} ha sonado sin parar en tu cuenta estas semanas. Lo tengo presente.`,
    `Sé que estas semanas has estado clavado con ${name}, ya lo verás reflejado en el set.`
  ],
  sameAsObsession: (name) => [
    `Y sí, ya sé que ${name} es tu más escuchado del momento, por eso está aquí.`,
    `Tu artista de estas semanas, obviamente tenía que sonar: ${name}.`
  ],
  allTime: (name) => [
    `De tu top histórico, de los que nunca fallan contigo: ${name}.`,
    `${name} lleva años en tu top. Un clásico personal tuyo.`
  ],
  repeated: (trackName, count) => [
    `Esta la has repetido como ${count} veces en los últimos días. No te juzgo, yo también lo haría.`,
    `Según mis cuentas, van ${count} reproducciones tuyas de esta en la semana. Va otra.`
  ],
  decade: (decade) => [
    `He notado que los ${decade}s dominan tu música. Esta es de esa época.`,
    `Tu década favorita, sin duda los ${decade}s. Como esta.`
  ]
};

const ERA_TOUCH = {
  retro: (year) => ` Salió en ${year} y sigue sonando igual de bien.`,
  reciente: () => ` De lo más reciente que hay.`
};

function currentDecade() {
  return Math.floor(new Date().getFullYear() / 10) * 10;
}

function timeSlot() {
  const h = new Date().getHours();
  if (h < 6) return 'madrugada';
  if (h < 12) return 'manana';
  if (h < 19) return 'tarde';
  return 'noche';
}

function pick(arr, keyPrefix) {
  const fresh = arr.filter((_, i) => !usedTemplates.has(`${keyPrefix}-${i}`));
  const pool = fresh.length ? fresh : arr;
  const chosen = pool[Math.floor(Math.random() * pool.length)];
  const idx = arr.indexOf(chosen);
  usedTemplates.add(`${keyPrefix}-${idx}`);
  if (usedTemplates.size > 40) usedTemplates.clear();
  return arr[idx];
}

let trackCounter = 0;

/**
 * Genera el guion del DJ para el SIGUIENTE track.
 * @param {object} nextTrack - track analizado (con .dj y opcional .recReason)
 * @param {object|null} transition - resultado de calculateTransition()
 * @param {object} opts - { isRecommendation, isFirst, profile }
 */
export async function generateDJScript(nextTrack, transition, opts = {}) {
  trackCounter++;
  const profile = opts.profile || null;
  const info = {
    name: nextTrack.name,
    artist: nextTrack.artists?.map((a) => a.name).join(' y ') || 'este artista',
    firstArtist: nextTrack.artists?.[0]?.name || null,
    year: nextTrack.dj?.year,
    reason: nextTrack.recReason || null
  };

  // Opción LLM (endpoint propio)
  if (LLM_URL) {
    try {
      const res = await fetch(LLM_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nextTrack: info, transition, opts: { ...opts, profile: undefined },
          profileFacts: profile ? {
            obsession: profile.obsessionArtist, allTime: profile.allTimeArtist,
            rising: profile.risingArtist, decade: profile.favoriteDecade
          } : null,
          style: 'DJ que conoce el Spotify del usuario, chill y cercano, sin jerga excesiva'
        })
      });
      const data = await res.json();
      if (data.script) return data.script;
    } catch (err) {
      console.warn('[DJ Script] LLM falló, usando plantillas locales:', err.message);
    }
  }

  const type = opts.isFirst ? 'apertura' : (transition?.type ?? 'lateral');
  const parts = [];

  // Apertura: saludo + dato del perfil para mostrar que te conoce
  if (opts.isFirst) {
    const slot = timeSlot();
    parts.push(pick(OPENERS[slot], `open-${slot}`) + '.');
    if (profile?.obsessionArtist) {
      parts.push(pick(PROFILE_LINES.obsession(profile.obsessionArtist), 'p-obs'));
    }
  }

  // Presentación de la canción
  if (opts.isRecommendation || info.reason) {
    parts.push(info.reason
      ? pick(REC_WITH_REASON, 'rec-r')(info, info.reason)
      : pick(REC_GENERIC, 'rec-g')(info));
  } else {
    parts.push(pick(BY_TYPE[type], type)(info));
  }

  // Comentario con conocimiento del perfil (~1 de cada 3, sin saturar)
  if (!opts.isFirst && profile && trackCounter % 3 === 0) {
    const candidates = [];
    if (info.firstArtist && info.firstArtist === profile.obsessionArtist) {
      candidates.push(...PROFILE_LINES.sameAsObsession(info.firstArtist));
    } else if (info.firstArtist && info.firstArtist === profile.allTimeArtist) {
      candidates.push(...PROFILE_LINES.allTime(info.firstArtist));
    }
    if (profile.mostRepeated?.track?.id === nextTrack.id && profile.mostRepeated.count > 1) {
      candidates.push(...PROFILE_LINES.repeated(info.name, profile.mostRepeated.count));
    }
    const decade = info.year ? Math.floor(info.year / 10) * 10 : null;
    const retroDecade = profile.favoriteDecade && profile.favoriteDecade <= currentDecade() - 20;
    if (decade && retroDecade && decade === profile.favoriteDecade) {
      candidates.push(...PROFILE_LINES.decade(decade));
    }
    if (candidates.length) parts.push(pick(candidates, 'p-fact'));
  }

  // Toque de época (solo para clásicos de verdad)
  const currentYear = new Date().getFullYear();
  if (info.year && info.year <= currentYear - 20 && Math.random() < 0.4) {
    parts[parts.length - 1] += ERA_TOUCH.retro(info.year);
  } else if (info.year && info.year >= currentYear - 1 && Math.random() < 0.3) {
    parts[parts.length - 1] += ERA_TOUCH.reciente();
  }

  return parts.join(' ');
}
