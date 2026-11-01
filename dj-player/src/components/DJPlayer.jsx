import { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import NowPlaying from './NowPlaying.jsx';
import Queue from './Queue.jsx';
import GenreSelector from './GenreSelector.jsx';
import SearchBar from './SearchBar.jsx';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer.js';
import { getTopTracks, getRecentlyPlayed, getPlaylists, getPlaylistTracks, logout } from '../services/spotifyAPI.js';
import {
  analyzeTracks, reorderQueue, calculateTransition, getRecommendations,
  filterByVibe, buildVibeSet, shuffle
} from '../services/djEngine.js';
import { generateDJScript } from '../services/djScript.js';
import { buildTasteProfile } from '../services/tasteProfile.js';
import { prepareDJVoice, stopAnyVoice } from '../services/voice.js';
import { getAudioContext, performTransition } from '../services/audioMixer.js';

const TRANSITION_LEAD_MS = 4000;   // inicia la transición 4 s antes del final
const PREPARE_LEAD_MS = 20000;     // prepara guion + voz 20 s antes
const TIME_RANGES = ['short_term', 'medium_term', 'long_term'];
const SPOTIFY_BLOCK = 50;          // canciones que se mandan a Spotify por bloque

export default function DJPlayer({ platform, onLogout }) {
  const {
    ready, mode, connectStatus, playerError, playerState,
    play, togglePlay, pausePlayback, setVolume, getPosition, next, retryConnect
  } = useSpotifyPlayer();

  const [queue, setQueue] = useState([]);
  const [currentIndex, setCurrentIndex] = useState(-1);
  const [vibeId, setVibeId] = useState('auto');
  const [useRecs, setUseRecs] = useState(true);
  const [sessionOn, setSessionOn] = useState(false);
  const [loading, setLoading] = useState(false);
  const [djTalking, setDjTalking] = useState(false);
  const [error, setError] = useState('');

  const preparedRef = useRef(null);   // { forIndex, voice }
  const profileRef = useRef(null);     // perfil de escucha (tasteProfile)
  const transitioningRef = useRef(false);
  const queueRef = useRef([]);
  const indexRef = useRef(-1);
  const sentRef = useRef({ start: 0, end: 0 });   // bloque [start, end) cargado en Spotify
  const sessionGenRef = useRef(0);                 // invalida tareas de una sesión terminada
  queueRef.current = queue;
  indexRef.current = currentIndex;

  // Manda a Spotify el bloque de la cola que empieza en `start`. Si la app
  // se duerme, la música continúa sola hasta el final de ese bloque.
  const sendBlock = useCallback(async (q, start) => {
    const end = Math.min(q.length, start + SPOTIFY_BLOCK);
    await play(q.slice(start, end).map((t) => t.uri));
    sentRef.current = { start, end };
  }, [play]);

  // ---------- Construcción del set ----------
  const buildSet = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      let base;
      if (vibeId === 'auto') {
        // Variedad: rango de tiempo aleatorio + recién escuchadas, todo barajado
        const range = TIME_RANGES[Math.floor(Math.random() * TIME_RANGES.length)];
        const [top, recent] = await Promise.all([
          getTopTracks(range, 50).catch(() => []),
          getRecentlyPlayed(30).catch(() => [])
        ]);
        base = shuffle([...top, ...recent]);
      } else {
        // Vibra específica: set REAL construido por búsqueda (funciona sin géneros)
        const vibeTracks = await buildVibeSet(vibeId, { limit: 30 });
        const mine = shuffle(await getTopTracks('medium_term', 30).catch(() => [])).slice(0, 8);
        base = shuffle([...vibeTracks, ...mine]);
      }

      // Dedup por id
      const seen = new Set();
      base = base.filter((t) => t && t.uri && !seen.has(t.id) && seen.add(t.id));

      if (!base.length) {
        const pls = await getPlaylists(5);
        if (pls.items?.length) base = await getPlaylistTracks(pls.items[0].id);
      }
      if (!base.length) throw new Error('No encontré música en tu cuenta.');

      let analyzed = await analyzeTracks(base);
      if (vibeId === 'auto') analyzed = filterByVibe(analyzed, vibeId);
      let ordered = reorderQueue(analyzed);

      // Descubrimientos: 1 de cada 3 canciones
      if (useRecs) {
        const recs = await getRecommendations({ vibeId, limit: 8, profile: profileRef.current });
        const analyzedRecs = (await analyzeTracks(recs)).map((t) => ({ ...t, isRecommendation: true }));
        const mixed = [];
        ordered.forEach((t, i) => {
          mixed.push(t);
          if ((i + 1) % 3 === 0 && analyzedRecs.length) mixed.push(analyzedRecs.shift());
        });
        ordered = mixed;
      }
      setQueue(ordered);
      return ordered;
    } catch (err) {
      console.error('[DJ] Error armando el set:', err);
      setError(err.message || 'Error armando el set');
      return [];
    } finally {
      setLoading(false);
    }
  }, [vibeId, useRecs]);

  // ---------- Reproducir la primera + voz de apertura ----------
  const kickoff = useCallback(async (set, startIdx = 0) => {
    // Un set nuevo invalida transiciones y voces de la sesión anterior
    const gen = ++sessionGenRef.current;
    transitioningRef.current = false;
    stopAnyVoice();
    const first = set[startIdx];
    const script = await generateDJScript(first, null, { isFirst: true, isRecommendation: !!first.isRecommendation, profile: profileRef.current });
    const voice = await prepareDJVoice(script);
    if (gen !== sessionGenRef.current) return;

    await sendBlock(set, startIdx);
    preparedRef.current = null;
    indexRef.current = startIdx;
    setCurrentIndex(startIdx);
    setSessionOn(true);

    if (voice.provider !== 'none') {
      try {
        await setVolume(0.35);
        setDjTalking(true);
        await voice.speak();
      } finally {
        // Pase lo que pase con la voz, la música vuelve a su volumen
        setDjTalking(false);
        if (gen === sessionGenRef.current) await setVolume(1.0).catch(() => {});
      }
    }
  }, [sendBlock, setVolume]);

  // ---------- Iniciar sesión DJ (desde el set armado) ----------
  const startSession = useCallback(async () => {
    getAudioContext(); // desbloquea audio con gesto del usuario (iOS lo exige)
    const set = queueRef.current.length ? queueRef.current : await buildSet();
    if (!set.length) return;
    try {
      await kickoff(set);
    } catch (err) {
      console.error('[DJ] No pude iniciar la reproducción:', err);
      setError(mode === 'connect'
        ? 'Abre Spotify en algún dispositivo y vuelve a intentar.'
        : 'No pude iniciar. ¿Tu cuenta es Premium?');
    }
  }, [buildSet, kickoff, mode]);

  // ---------- Iniciar desde una búsqueda (canción o álbum) ----------
  const startFromTracks = useCallback(async (picked) => {
    getAudioContext();
    setLoading(true);
    setError('');
    try {
      let analyzed = await analyzeTracks(picked);
      // Si es una sola canción, completamos el set con recomendaciones de tu música
      if (analyzed.length === 1 && useRecs) {
        const recs = await getRecommendations({ vibeId, limit: 12, profile: profileRef.current });
        const analyzedRecs = (await analyzeTracks(recs)).map((t) => ({ ...t, isRecommendation: true }));
        analyzed = [analyzed[0], ...analyzedRecs];
      }
      setQueue(analyzed);
      queueRef.current = analyzed;
      await kickoff(analyzed);
    } catch (err) {
      console.error('[DJ] Error iniciando desde búsqueda:', err);
      setError('No pude reproducir eso. ¿Hay un dispositivo de Spotify activo?');
    } finally {
      setLoading(false);
    }
  }, [kickoff, useRecs, vibeId]);

  // ---------- Transición DJ hacia cualquier canción de la cola ----------
  const transitionToIndex = useCallback(async (targetIdx) => {
    if (transitioningRef.current) return;
    const q = queueRef.current;
    if (targetIdx < 0 || targetIdx >= q.length) { setSessionOn(false); return; }
    transitioningRef.current = true;
    const gen = sessionGenRef.current;
    const isActive = () => gen === sessionGenRef.current;

    const current = indexRef.current >= 0 ? q[indexRef.current] : null;
    const nextTrack = q[targetIdx];
    try {
      // La voz pre-generada solo sirve si era para ESTE destino
      let voice = preparedRef.current?.forIndex === targetIdx ? preparedRef.current.voice : null;
      if (!voice) {
        const transition = calculateTransition(current, nextTrack);
        const script = await generateDJScript(nextTrack, transition, { isRecommendation: !!nextTrack.isRecommendation, profile: profileRef.current });
        voice = await prepareDJVoice(script);
      }
      if (!isActive()) return;
      setDjTalking(voice.provider !== 'none');
      // Si es la siguiente y ya está en el bloque cargado en Spotify, un
      // skip basta (la lista nativa sigue alineada). Para saltos lejanos o
      // al agotar el bloque, cargamos un bloque nuevo desde el destino.
      const isJustNext = targetIdx === indexRef.current + 1;
      const inBlock = targetIdx >= sentRef.current.start && targetIdx < sentRef.current.end;
      const playNext = isJustNext && inBlock
        ? () => next()
        : () => sendBlock(q, targetIdx);
      await performTransition({ setVolume, playNext, voice, isActive });
    } catch (err) {
      console.error('[DJ] Falló la transición, saltando directo:', err);
      if (isActive()) {
        try { await sendBlock(q, targetIdx); await setVolume(1.0); } catch { /* silencioso */ }
      }
    } finally {
      if (isActive()) {
        setDjTalking(false);
        indexRef.current = targetIdx;
        setCurrentIndex(targetIdx);
        preparedRef.current = null;
        transitioningRef.current = false;
      }
    }
  }, [next, sendBlock, setVolume]);

  // Siguiente canción = transición al índice que sigue
  const performNextTransition = useCallback(
    () => transitionToIndex(indexRef.current + 1),
    [transitionToIndex]
  );

  // ---------- Adelantar hasta una canción de la cola (tap en Queue) ----------
  const jumpTo = useCallback(async (targetIdx) => {
    if (sessionOn) {
      await transitionToIndex(targetIdx);
    } else {
      // Sin sesión activa: arranca la sesión directo en esa canción
      getAudioContext();
      const q = queueRef.current;
      if (!q[targetIdx]) return;
      try {
        await kickoff(q, targetIdx);
      } catch (err) {
        console.error('[DJ] No pude iniciar desde esa canción:', err);
        setError('No pude reproducir esa canción. ¿Hay un dispositivo activo?');
      }
    }
  }, [sessionOn, transitionToIndex, kickoff]);

  // ---------- Agregar canciones a la cola SIN reiniciar la sesión ----------
  // No usamos la cola nativa de Spotify (/me/player/queue): esas canciones
  // suenan ANTES del resto de la lista y desalinean al DJ. Las nuevas se
  // cargan en Spotify cuando la transición llega al final del bloque actual.
  const addToQueue = useCallback(async (picked) => {
    try {
      const analyzed = await analyzeTracks(picked);
      const existing = new Set(queueRef.current.map((t) => t.id));
      const fresh = analyzed.filter((t) => !existing.has(t.id));
      if (!fresh.length) return;
      const merged = [...queueRef.current, ...fresh];
      queueRef.current = merged;
      setQueue(merged);
    } catch (err) {
      console.error('[DJ] Error agregando a la cola:', err);
    }
  }, []);

  // ---------- Terminar la sesión DJ (sin cerrar la sesión de Spotify) ----------
  const endSession = useCallback(async () => {
    sessionGenRef.current += 1;      // cancela transiciones y voces en curso
    stopAnyVoice();
    preparedRef.current = null;
    transitioningRef.current = false;
    sentRef.current = { start: 0, end: 0 };
    setDjTalking(false);
    setSessionOn(false);
    setCurrentIndex(-1);
    try { await pausePlayback(); } catch { /* mejor esfuerzo */ }
    try { await setVolume(1.0); } catch { /* mejor esfuerzo */ }
  }, [pausePlayback, setVolume]);

  // Vigila la posición: prepara la voz y dispara la transición
  useEffect(() => {
    if (!sessionOn) return undefined;
    const gen = sessionGenRef.current;
    const interval = setInterval(async () => {
      if (transitioningRef.current || gen !== sessionGenRef.current) return;
      const s = await getPosition().catch(() => null);
      if (!s || s.paused || !s.duration) return;
      const remaining = s.duration - s.position;
      const idx = indexRef.current;
      const q = queueRef.current;

      if (remaining < PREPARE_LEAD_MS && idx < q.length - 1 && preparedRef.current?.forIndex !== idx + 1) {
        preparedRef.current = { forIndex: idx + 1, voice: null };
        const upcoming = q[idx + 1];
        const transition = calculateTransition(q[idx], upcoming);
        const script = await generateDJScript(upcoming, transition, { isRecommendation: !!upcoming.isRecommendation, profile: profileRef.current });
        const voice = await prepareDJVoice(script);
        if (preparedRef.current?.forIndex === idx + 1) preparedRef.current.voice = voice;
      }
      if (remaining < TRANSITION_LEAD_MS && gen === sessionGenRef.current) performNextTransition();
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionOn, getPosition, performNextTransition]);

  // Guardián de segundo plano: los navegadores NO permiten voz con la app
  // oculta, y una transición congelada dejaría la música al 15-35 % de
  // volumen (por eso "no se escuchaba"). Al salir: cortamos la voz y
  // subimos la música a 100 % de inmediato. Al volver: destrancamos el
  // sintetizador y normalizamos el volumen.
  useEffect(() => {
    if (!sessionOn) return undefined;
    const onVisibility = async () => {
      if (document.visibilityState === 'hidden') {
        stopAnyVoice();
        setDjTalking(false);
        try { await setVolume(1.0); } catch { /* mejor esfuerzo */ }
      } else {
        try { window.speechSynthesis?.resume(); } catch { /* nada */ }
        if (!transitioningRef.current) {
          try { await setVolume(1.0); } catch { /* mejor esfuerzo */ }
        }
      }
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [sessionOn, setVolume]);

  // Mantener la pantalla despierta durante la sesión (Wake Lock).
  // Con pantalla apagada el navegador congela la app: no habría voz ni
  // transiciones. Con la lista nativa la música seguiría, pero el DJ no.
  useEffect(() => {
    if (!sessionOn || !('wakeLock' in navigator)) return undefined;
    let lock = null;
    const request = async () => {
      try { lock = await navigator.wakeLock.request('screen'); }
      catch (err) { console.warn('[DJ] Wake Lock no disponible:', err.message); }
    };
    request();
    const onVisible = () => { if (document.visibilityState === 'visible') request(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      lock?.release?.().catch(() => {});
    };
  }, [sessionOn]);

  // Resincronizar: si Spotify avanzó solo (app dormida), al despertar
  // encontramos en qué canción va y actualizamos el índice del DJ.
  useEffect(() => {
    if (!sessionOn || transitioningRef.current) return;
    const uri = playerState.trackUri;
    if (!uri) return;
    const q = queueRef.current;
    // Primero dentro del bloque cargado en Spotify (puede haber repetidas)
    const { start, end } = sentRef.current;
    const inBlock = q.slice(start, end).findIndex((t) => t.uri === uri);
    const idx = inBlock >= 0 ? start + inBlock : q.findIndex((t) => t.uri === uri);
    if (idx >= 0 && idx !== indexRef.current) {
      preparedRef.current = null; // la voz preparada ya no corresponde
      setCurrentIndex(idx);
    }
  }, [playerState.trackUri, sessionOn]);

  // Cargar el perfil de escucha una vez (lo que el DJ sabe de ti)
  useEffect(() => {
    if (!ready || profileRef.current) return;
    buildTasteProfile()
      .then((p) => { profileRef.current = p; })
      .catch((err) => console.warn('[DJ] No pude armar tu perfil de escucha:', err.message));
  }, [ready]);

  // Rearmar el set al cambiar la vibra (si no hay sesión activa)
  useEffect(() => {
    if (!sessionOn && ready) buildSet();
  }, [vibeId, useRecs, ready, sessionOn, buildSet]);

  const currentTrack = currentIndex >= 0 ? queue[currentIndex] : null;

  return (
    <main className="min-h-screen max-w-lg lg:max-w-4xl mx-auto pb-32">
      <header className="flex items-center justify-between px-6 pt-6 pb-4">
        <div>
          <h1 className="font-display font-bold text-xl">DJ <span className="text-neon">Player</span></h1>
          <p className="font-mono text-[10px] text-mist uppercase tracking-widest">
            {platform} · {mode === 'sdk' ? 'audio interno' : mode === 'connect' ? 'control remoto' : 'conectando…'}
          </p>
        </div>
        <button type="button" onClick={() => { logout(); onLogout(); }} className="btn-ghost text-sm !min-h-[40px] !py-2">
          Salir
        </button>
      </header>

      <SearchBar onPlayTracks={startFromTracks} onAddTracks={addToQueue} disabled={loading} />

      <GenreSelector vibeId={vibeId} onChange={setVibeId} disabled={sessionOn || loading} />

      <div className="px-6 mb-6">
        <label className="flex items-center gap-3 text-sm text-mist cursor-pointer w-fit">
          <input type="checkbox" checked={useRecs} disabled={sessionOn}
                 onChange={(e) => setUseRecs(e.target.checked)}
                 className="w-5 h-5 accent-neon" />
          Incluir descubrimientos según mi música
        </label>
      </div>

      <NowPlaying track={currentTrack}
                  position={playerState.position}
                  duration={playerState.duration}
                  djTalking={djTalking} />

      {mode === 'connect' && !ready && (
        <div role="status" className="mx-6 mt-4 rounded-2xl border border-line bg-panel px-4 py-3 text-sm">
          {connectStatus === 'searching' && <p>Buscando dispositivos de Spotify…</p>}
          {connectStatus === 'no-device' && (
            <p>
              No encontré ningún dispositivo de Spotify. Abre la app de Spotify en este u otro
              dispositivo y reproduce algo un segundo; lo detecto solo al volver aquí.
            </p>
          )}
          {connectStatus === 'error' && <p>No pude conectar con Spotify. Revisa tu conexión a internet.</p>}
          <button type="button" onClick={retryConnect} disabled={connectStatus === 'searching'}
                  className="block mt-2 text-neon-soft underline disabled:opacity-60">
            Buscar dispositivos otra vez
          </button>
        </div>
      )}

      {(error || playerError) && (
        <div role="alert" className="mx-6 mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
          {error || playerError}
          {mode === 'connect' && ready && (
            <button type="button" onClick={retryConnect} className="block mt-2 text-neon-soft underline">
              Buscar dispositivos otra vez
            </button>
          )}
        </div>
      )}

      <Queue tracks={queue} currentIndex={currentIndex} onJump={jumpTo} jumping={djTalking} />

      <nav className="fixed bottom-0 inset-x-0 bg-panel/90 backdrop-blur border-t border-line"
           style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
        <div className="max-w-lg lg:max-w-4xl mx-auto flex items-center justify-center gap-3 px-6 pt-3">
          {!sessionOn ? (
            <button type="button" onClick={startSession} disabled={!ready || loading}
                    className="btn-primary flex-1 max-w-xs disabled:opacity-40">
              {loading ? 'Armando tu set…' : 'Iniciar sesión DJ'}
            </button>
          ) : (
            <>
              <button type="button" onClick={togglePlay} className="btn-primary w-20 shrink-0"
                      aria-label={playerState.paused ? 'Reproducir' : 'Pausar'}>
                {playerState.paused ? '▶' : '⏸'}
              </button>
              <button type="button" onClick={performNextTransition} className="btn-ghost w-20 shrink-0 !px-2"
                      aria-label="Siguiente con transición DJ">
                ⏭ DJ
              </button>
              <button type="button" onClick={endSession} className="btn-ghost shrink-0 !px-3 text-sm"
                      aria-label="Terminar sesión DJ">
                ⏹ Terminar
              </button>
            </>
          )}
        </div>
      </nav>
    </main>
  );
}

DJPlayer.propTypes = {
  platform: PropTypes.string.isRequired,
  onLogout: PropTypes.func.isRequired
};
