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
  getStoredToken, refreshToken, getDevices, transferPlayback,
  playTracks, pause, resume, setRemoteVolume, getPlaybackState, skipNext
} from '../services/spotifyAPI.js';

const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';

function sdkSupported() {
  // El SDK no funciona en navegadores iOS/iPadOS
  const ua = navigator.userAgent;
  const isIOS = /iPad|iPhone|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
  return !isIOS;
}

export function useSpotifyPlayer() {
  const [ready, setReady] = useState(false);
  const [mode, setMode] = useState('none'); // 'sdk' | 'connect' | 'none'
  const [playerState, setPlayerState] = useState({
    paused: true, position: 0, duration: 0, trackUri: null
  });
  const playerRef = useRef(null);
  const deviceIdRef = useRef(null);
  const pollRef = useRef(null);

  // ---------- Modo SDK ----------
  useEffect(() => {
    if (!sdkSupported()) {
      initConnectMode();
      return;
    }
    window.onSpotifyWebPlaybackSDKReady = () => {
      const player = new window.Spotify.Player({
        name: 'DJ Player (Edwin)',
        getOAuthToken: async (cb) => cb(getStoredToken() || (await refreshToken())),
        volume: 1.0
      });
      player.addListener('ready', ({ device_id }) => {
        deviceIdRef.current = device_id;
        setMode('sdk');
        setReady(true);
      });
      player.addListener('not_ready', () => setReady(false));
      player.addListener('player_state_changed', (s) => {
        if (!s) return;
        setPlayerState({
          paused: s.paused,
          position: s.position,
          duration: s.duration,
          trackUri: s.track_window?.current_track?.uri ?? null
        });
      });
      player.addListener('initialization_error', ({ message }) => {
        console.warn('[Player] SDK no disponible, cambiando a modo Connect:', message);
        initConnectMode();
      });
      player.addListener('authentication_error', ({ message }) =>
        console.error('[Player] Error de autenticación:', message));
      player.addListener('account_error', ({ message }) =>
        console.error('[Player] Se requiere Spotify Premium:', message));
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
    return () => clearInterval(pollRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---------- Modo Connect (iPad / fallback) ----------
  const initConnectMode = useCallback(async () => {
    try {
      const devices = await getDevices();
      const active = devices.find((d) => d.is_active) || devices[0];
      if (active) {
        deviceIdRef.current = active.id;
        if (!active.is_active) await transferPlayback(active.id, false);
        setMode('connect');
        setReady(true);
        // Sondeo del estado cada 1 s (Connect no tiene eventos)
        clearInterval(pollRef.current);
        pollRef.current = setInterval(async () => {
          try {
            const s = await getPlaybackState();
            if (s?.item) {
              setPlayerState({
                paused: !s.is_playing,
                position: s.progress_ms,
                duration: s.item.duration_ms,
                trackUri: s.item.uri
              });
            }
          } catch { /* silencioso */ }
        }, 1000);
      } else {
        setMode('connect');
        setReady(false); // el usuario debe abrir Spotify en algún dispositivo
      }
    } catch (err) {
      console.error('[Player] Error iniciando modo Connect:', err);
    }
  }, []);

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
      return s ? { position: s.position, duration: s.duration, paused: s.paused } : null;
    }
    return { position: playerState.position, duration: playerState.duration, paused: playerState.paused };
  }, [mode, playerState]);

  return { ready, mode, playerState, play, togglePlay, setVolume, getPosition, next, retryConnect: initConnectMode };
}
