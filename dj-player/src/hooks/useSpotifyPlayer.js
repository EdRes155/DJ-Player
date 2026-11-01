// ============================================================
// useSpotifyPlayer — reproducción real de Spotify
// ------------------------------------------------------------
// Estrategia por plataforma:
//   • Escritorio / Electron: Web Playback SDK (audio dentro de
//     la app, volumen suave, requiere Spotify Premium).
//   • iPad / Android (donde el SDK no corre): modo CONTROL —
//     la app maneja la reproducción de tu app de Spotify vía
//     Connect API (play, skip, volumen). La voz DJ suena local.
// ============================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import {
  getAccessToken, getDevices, transferPlayback,
  playTracks, pause, resume, setRemoteVolume, getPlaybackState, skipNext
} from '../services/spotifyAPI.js';

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
const DEVICE_RETRY_MS = 5000;   // re-búsqueda de dispositivos Connect
const POLL_PLAYING_MS = 1000;   // sondeo Connect mientras suena
const POLL_PAUSED_MS = 4000;    // sondeo Connect en pausa (menos tráfico)

function sdkSupported() {
  // El SDK no funciona en navegadores iOS/iPadOS
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  return !isIOS;
}

export function useSpotifyPlayer() {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState('none'); // 'sdk' | 'connect' | 'none'
  // Estado de la conexión Connect: 'idle' | 'searching' | 'no-device' | 'error' | 'ready'
  const [connectStatus, setConnectStatus] = useState('idle');
  const [playerError, setPlayerError] = useState('');
  const [playerState, setPlayerState] = useState({
    paused: true, position: 0, duration: 0, trackUri: null
  });
  const playerRef = useRef(null);
  const deviceIdRef = useRef(null);
  const pollRef = useRef(null);
  const retryRef = useRef(null);
  const genRef = useRef(0);          // invalida tareas de montajes anteriores
  const pausedRef = useRef(true);
  pausedRef.current = playerState.paused;

  const stopTimers = () => {
    clearTimeout(pollRef.current);
    clearTimeout(retryRef.current);
    pollRef.current = null;
    retryRef.current = null;
  };

  // ---------- Modo Connect (iPad / fallback) ----------
  const startPolling = useCallback((gen) => {
    clearTimeout(pollRef.current);
    const tick = async () => {
      if (gen !== genRef.current) return;
      if (!document.hidden) {
        try {
          const s = await getPlaybackState();
          if (gen !== genRef.current) return;
          if (s?.item) {
            setPlayerState({
              paused: !s.is_playing,
              position: s.progress_ms,
              duration: s.item.duration_ms,
              trackUri: s.item.uri
            });
          }
        } catch { /* silencioso: el siguiente sondeo lo reintenta */ }
      }
      if (gen !== genRef.current) return;
      pollRef.current = setTimeout(tick, pausedRef.current ? POLL_PAUSED_MS : POLL_PLAYING_MS);
    };
    tick();
  }, []);

  const initConnectMode = useCallback(async () => {
    const gen = genRef.current;
    clearTimeout(retryRef.current);
    setMode('connect');
    setConnectStatus('searching');
    try {
      const devices = await getDevices();
      if (gen !== genRef.current) return;
      const active = devices.find((d) => d.is_active) || devices[0];
      if (active) {
        deviceIdRef.current = active.id;
        if (!active.is_active) await transferPlayback(active.id, false);
        if (gen !== genRef.current) return;
        setConnectStatus('ready');
        setPlayerError('');
        setReady(true);
        startPolling(gen);
      } else {
        // Nadie tiene Spotify abierto: seguimos buscando solos
        setReady(false);
        setConnectStatus('no-device');
        retryRef.current = setTimeout(initConnectMode, DEVICE_RETRY_MS);
      }
    } catch (err) {
      if (gen !== genRef.current) return;
      console.error('[Player] Error iniciando modo Connect:', err);
      setReady(false);
      setConnectStatus('error');
      retryRef.current = setTimeout(initConnectMode, DEVICE_RETRY_MS * 2);
    }
  }, [startPolling]);

  // Al volver a la app (p. ej. después de abrir Spotify) re-detectamos ya
  useEffect(() => {
    if (mode !== 'connect' || connectStatus === 'ready') return undefined;
    const onBack = () => {
      if (document.visibilityState === 'visible' && connectStatus !== 'searching') initConnectMode();
    };
    document.addEventListener('visibilitychange', onBack);
    window.addEventListener('focus', onBack);
    return () => {
      document.removeEventListener('visibilitychange', onBack);
      window.removeEventListener('focus', onBack);
    };
  }, [mode, connectStatus, initConnectMode]);

  // ---------- Inicialización (SDK o Connect) + limpieza común ----------
  useEffect(() => {
    const gen = ++genRef.current;

    if (!sdkSupported()) {
      initConnectMode();
    } else {
      window.onSpotifyWebPlaybackSDKReady = () => {
        if (gen !== genRef.current) return;
        const player = new window.Spotify.Player({
          name: 'DJ Player (Edwin)',
          getOAuthToken: async (cb) => cb(await getAccessToken()),
          volume: 1.0
        });
        player.addListener('ready', ({ device_id }) => {
          if (gen !== genRef.current) return;
          deviceIdRef.current = device_id;
          setMode('sdk');
          setPlayerError('');
          setReady(true);
        });
        player.addListener('not_ready', () => setReady(false));
        player.addListener('player_state_changed', (s) => {
          if (!s || gen !== genRef.current) return;
          setPlayerState({
            paused: s.paused,
            position: s.position,
            duration: s.duration,
            trackUri: s.track_window?.current_track?.uri ?? null
          });
        });
        player.addListener('initialization_error', ({ message }) => {
          console.warn('[Player] SDK no disponible, cambiando a modo Connect:', message);
          player.disconnect();
          if (playerRef.current === player) playerRef.current = null;
          if (gen === genRef.current) initConnectMode();
        });
        player.addListener('authentication_error', ({ message }) => {
          console.error('[Player] Error de autenticación:', message);
          setPlayerError('Spotify rechazó la sesión. Sal y vuelve a conectar tu cuenta.');
        });
        player.addListener('account_error', ({ message }) => {
          console.error('[Player] Se requiere Spotify Premium:', message);
          setPlayerError('La reproducción requiere una cuenta de Spotify Premium.');
        });
        player.connect();
        playerRef.current = player;
      };
      if (!document.querySelector(`script[src="${SDK_URL}"]`)) {
        const script = document.createElement('script');
        script.src = SDK_URL;
        script.async = true;
        document.body.appendChild(script);
      } else if (window.Spotify) {
        window.onSpotifyWebPlaybackSDKReady();
      }
    }

    return () => {
      genRef.current += 1;          // cancela inicializaciones y sondeos pendientes
      stopTimers();
      playerRef.current?.disconnect();
      playerRef.current = null;
      deviceIdRef.current = null;
      window.onSpotifyWebPlaybackSDKReady = () => {};
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // SDK: el reproductor solo emite eventos en cambios de estado; mientras
  // suena, consultamos la posición real para que la barra avance continua.
  useEffect(() => {
    if (mode !== 'sdk' || playerState.paused) return undefined;
    const id = setInterval(async () => {
      const s = await playerRef.current?.getCurrentState();
      if (s) setPlayerState((p) => ({ ...p, position: s.position, duration: s.duration, paused: s.paused }));
    }, 1000);
    return () => clearInterval(id);
  }, [mode, playerState.paused]);

  // ---------- API unificada ----------
  const play = useCallback(async (uris, positionMs = 0) => {
    await playTracks(uris, deviceIdRef.current, positionMs);
  }, []);

  const togglePlay = useCallback(async () => {
    if (mode === 'sdk' && playerRef.current) {
      await playerRef.current.togglePlay();
    } else {
      playerState.paused ? await resume() : await pause();
    }
  }, [mode, playerState.paused]);

  const pausePlayback = useCallback(async () => {
    if (mode === 'sdk' && playerRef.current) await playerRef.current.pause();
    else await pause();
  }, [mode]);

  const setVolume = useCallback(async (v) => {
    if (mode === 'sdk' && playerRef.current) {
      await playerRef.current.setVolume(v);
    } else {
      await setRemoteVolume(v * 100, deviceIdRef.current);
    }
  }, [mode]);

  const next = useCallback(async () => {
    if (mode === 'sdk' && playerRef.current) {
      await playerRef.current.nextTrack();
    } else {
      await skipNext();
    }
  }, [mode]);

  const getPosition = useCallback(async () => {
    if (mode === 'sdk' && playerRef.current) {
      const s = await playerRef.current.getCurrentState();
      return s ? {
        position: s.position, duration: s.duration, paused: s.paused,
        trackUri: s.track_window?.current_track?.uri ?? null
      } : null;
    }
    return {
      position: playerState.position, duration: playerState.duration,
      paused: playerState.paused, trackUri: playerState.trackUri
    };
  }, [mode, playerState]);

  return {
    ready, mode, connectStatus, playerError, playerState,
    play, togglePlay, pausePlayback, setVolume, getPosition, next,
    retryConnect: initConnectMode
  };
}
