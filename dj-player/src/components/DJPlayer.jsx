import { useState, useEffect, useRef, useCallback } from 'react';
import PropTypes from 'prop-types';
import NowPlaying from './NowPlaying.jsx';
import Queue from './Queue.jsx';
import GenreSelector from './GenreSelector.jsx';
import SearchBar from './SearchBar.jsx';
import { useSpotifyPlayer } from '../hooks/useSpotifyPlayer.js';
import { getTopTracks, getRecentlyPlayed, getPlaylists, getPlaylistTracks, addToPlaybackQueue, logout } from '../services/spotifyAPI.js';
import {
  analyzeTracks, reorderQueue, calculateTransition, getRecommendations,
  filterByVibe, buildVibeSet, shuffle
} from '../services/djEngine.js';
import { generateDJScript } from '../services/djScript.js';
import { buildTasteProfile } from '../services/tasteProfile.js';
import { prepareDJVoice } from '../services/voice.js';
import { getAudioContext, performTransition } from '../services/audioMixer.js';

const TRANSITION_LEAD_MS = 4000;   // inicia la transición 4 s antes del final
const PREPARE_LEAD_MS = 20000;     // prepara guion + voz 20 s antes
const TIME_RANGES = ['short_term', 'medium_term', 'long_term'];

export default function DJPlayer({ platform, onLogout }) {
  const { ready, mode, playerState, play, togglePlay, setVolume, getPosition, next, retryConnect } = useSpotifyPlayer();

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
  queueRef.current = queue;
  indexRef.current = currentIndex;

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
  const kickoff = useCallback(async (set) => {
    const first = set[0];
    const script = await generateDJScript(first, null, { isFirst: true, isRecommendation: !!first.isRecommendation, profile: profileRef.current });
    const voice = await prepareDJVoice(script);

    // Mandamos toda la lista a Spotify: si la app se duerme, la música continúa sola
    await play(set.slice(0, 50).map((t) => t.uri));
    setCurrentIndex(0);
    setSessionOn(true);

    if (voice.provider !== 'none') {
      await setVolume(0.35);
      setDjTalking(true);
      await voice.speak();
      setDjTalking(false);
      await setVolume(1.0);
    }
  }, [play, setVolume]);

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
      setDjTalking(voice.provider !== 'none');
      // Si es la siguiente en la lista nativa de Spotify, un skip basta
      // (así la lista nativa sigue alineada). Para saltos lejanos,
      // reenviamos la lista desde el destino.
      const isJustNext = targetIdx === indexRef.current + 1;
      const playNext = isJustNext
        ? () => next()
        : () => play(q.slice(targetIdx, targetIdx + 50).map((t) => t.uri));
      await performTransition({ setVolume, playNext, voice });
    } catch (err) {
      console.error('[DJ] Falló la transición, saltando directo:', err);
      try { await play([nextTrack.uri]); await setVolume(1.0); } catch { /* silencioso */ }
    } finally {
      setDjTalking(false);
      setCurrentIndex(targetIdx);
      preparedRef.current = null;
      transitioningRef.current = false;
    }
  }, [play, next, setVolume]);

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
        await kickoff(q.slice(targetIdx));
        // kickoff pone index 0 sobre el slice; reponemos la cola completa y el índice real
        setQueue(q);
        queueRef.current = q;
        setCurrentIndex(targetIdx);
      } catch (err) {
        console.error('[DJ] No pude iniciar desde esa canción:', err);
        setError('No pude reproducir esa canción. ¿Hay un dispositivo activo?');
      }
    }
  }, [sessionOn, transitionToIndex, kickoff]);

  // ---------- Agregar canciones a la cola SIN reiniciar la sesión ----------
  const addToQueue = useCallback(async (picked) => {
    try {
      const analyzed = await analyzeTracks(picked);
      let freshAdded = [];
      setQueue((prev) => {
        const existing = new Set(prev.map((t) => t.id));
        freshAdded = analyzed.filter((t) => !existing.has(t.id));
        const merged = [...prev, ...freshAdded];
        queueRef.current = merged;
        return merged;
      });
      // Respaldo: también a la cola nativa de Spotify (si la app se duerme,
      // Spotify seguirá con estas canciones aunque sin voz del DJ)
      if (sessionOn) {
        for (const t of freshAdded) {
          try { await addToPlaybackQueue(t.uri); } catch { /* mejor esfuerzo */ }
        }
      }
    } catch (err) {
      console.error('[DJ] Error agregando a la cola:', err);
    }
  }, [sessionOn]);

  // Vigila la posición: prepara la voz y dispara la transición
  useEffect(() => {
    if (!sessionOn) return undefined;
    const interval = setInterval(async () => {
      if (transitioningRef.current) return;
      const s = await getPosition();
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
      if (remaining < TRANSITION_LEAD_MS) performNextTransition();
    }, 1000);
    return () => clearInterval(interval);
  }, [sessionOn, getPosition, performNextTransition]);

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
    const idx = q.findIndex((t) => t.uri === uri);
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

      {error && (
        <div className="mx-6 mt-4 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
          {error}
          {mode === 'connect' && (
            <button type="button" onClick={retryConnect} className="block mt-2 text-neon-soft underline">
              Buscar dispositivos otra vez
            </button>
          )}
        </div>
      )}

      <Queue tracks={queue} currentIndex={currentIndex} onJump={jumpTo} jumping={djTalking} />

      <nav className="fixed bottom-0 inset-x-0 bg-panel/90 backdrop-blur border-t border-line"
           style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 12px)' }}>
        <div className="max-w-lg lg:max-w-4xl mx-auto flex items-center justify-center gap-4 px-6 pt-3">
          {!sessionOn ? (
            <button type="button" onClick={startSession} disabled={!ready || loading}
                    className="btn-primary flex-1 max-w-xs disabled:opacity-40">
              {loading ? 'Armando tu set…' : 'Iniciar sesión DJ'}
            </button>
          ) : (
            <>
              <button type="button" onClick={togglePlay} className="btn-primary w-24" aria-label="Reproducir o pausar">
                {playerState.paused ? '▶' : '⏸'}
              </button>
              <button type="button" onClick={performNextTransition} className="btn-ghost w-24"
                      aria-label="Siguiente con transición DJ">
                ⏭ DJ
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
