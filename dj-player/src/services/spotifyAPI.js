// ============================================================
// Spotify Web API — OAuth PKCE + datos + control de reproducción
// ------------------------------------------------------------
// NOTA IMPORTANTE (2026): para apps creadas después de nov-2024,
// Spotify deprecó /audio-features, /recommendations y preview_url.
// Este servicio NO depende de esos endpoints: la inteligencia del
// DJ (djEngine.js) trabaja con metadata que SÍ está disponible
// (top tracks/artists, géneros del artista, popularidad, año).
// Si tu app tiene acceso legacy, tryGetAudioFeatures() lo aprovecha.
// ============================================================

const CLIENT_ID = import.meta.env.VITE_SPOTIFY_CLIENT_ID;
const REDIRECT_URI = import.meta.env.VITE_SPOTIFY_REDIRECT_URI;
const AUTH_URL = 'https://accounts.spotify.com/authorize';
const TOKEN_URL = 'https://accounts.spotify.com/api/token';
const API = 'https://api.spotify.com/v1';

const SCOPES = [
  'user-read-private',
  'user-read-email',
  'user-top-read',
  'user-read-recently-played',
  'playlist-read-private',
  'user-read-playback-state',
  'user-modify-playback-state',
  'streaming'
].join(' ');

// ---------- PKCE helpers ----------
function randomString(length = 64) {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const values = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(values, (v) => chars[v % chars.length]).join('');
}

async function sha256base64url(plain) {
  const data = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

// ---------- Autenticación ----------
export async function redirectToLogin() {
  const verifier = randomString();
  localStorage.setItem('sp_verifier', verifier);
  const challenge = await sha256base64url(verifier);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    response_type: 'code',
    redirect_uri: REDIRECT_URI,
    scope: SCOPES,
    code_challenge_method: 'S256',
    code_challenge: challenge
  });
  window.location.href = `${AUTH_URL}?${params}`;
}

export async function handleCallback() {
  const code = new URLSearchParams(window.location.search).get('code');
  if (!code) return null;
  const verifier = localStorage.getItem('sp_verifier');
  try {
    const res = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: verifier
      })
    });
    const data = await res.json();
    if (data.access_token) {
      saveTokens(data);
      window.history.replaceState({}, '', window.location.pathname);
      return data.access_token;
    }
    throw new Error(data.error_description || 'Token exchange failed');
  } catch (err) {
    console.error('[Spotify] Error en callback:', err);
    return null;
  }
}

function saveTokens(data) {
  localStorage.setItem('sp_token', data.access_token);
  localStorage.setItem('sp_refresh', data.refresh_token || localStorage.getItem('sp_refresh') || '');
  localStorage.setItem('sp_expires', String(Date.now() + data.expires_in * 1000));
}

// Generación de sesión: logout() la incrementa y cualquier operación
// iniciada antes (refresh, peticiones a la API) deja de tener efecto.
let sessionGen = 0;
const pending = new Set();       // AbortControllers de peticiones en vuelo
let refreshPromise = null;       // renovación centralizada (sin concurrencia)

function trackedFetch(url, options = {}) {
  const controller = new AbortController();
  pending.add(controller);
  return fetch(url, { ...options, signal: controller.signal })
    .finally(() => pending.delete(controller));
}

export function getStoredToken() {
  const token = localStorage.getItem('sp_token');
  const expires = Number(localStorage.getItem('sp_expires') || 0);
  if (token && Date.now() < expires - 60_000) return token;
  return null;
}

export function refreshToken() {
  if (!refreshPromise) {
    refreshPromise = doRefresh().finally(() => { refreshPromise = null; });
  }
  return refreshPromise;
}

async function doRefresh() {
  const refresh = localStorage.getItem('sp_refresh');
  if (!refresh) return null;
  const gen = sessionGen;
  try {
    const res = await trackedFetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        grant_type: 'refresh_token',
        refresh_token: refresh
      })
    });
    const data = await res.json();
    // Si cerraron sesión mientras esperábamos, NO restauramos credenciales
    if (gen !== sessionGen) return null;
    if (data.access_token) {
      saveTokens(data);
      return data.access_token;
    }
    return null;
  } catch (err) {
    if (gen === sessionGen) console.error('[Spotify] Error al refrescar token:', err);
    return null;
  }
}

/** Token vigente (renovándolo si hace falta) o null. */
export async function getAccessToken() {
  return getStoredToken() || (await refreshToken());
}

// Cachés del service worker que pudieron guardar datos de la cuenta
// (versiones anteriores cacheaban las respuestas de api.spotify.com).
export const PRIVATE_CACHES = ['spotify-api', 'tts-audio'];

export async function purgePrivateCaches() {
  if (typeof caches === 'undefined') return;
  await Promise.all(PRIVATE_CACHES.map((name) => caches.delete(name).catch(() => false)));
}

export function logout() {
  sessionGen += 1;
  pending.forEach((c) => c.abort());
  pending.clear();
  refreshPromise = null;
  ['sp_token', 'sp_refresh', 'sp_expires', 'sp_verifier'].forEach((k) => localStorage.removeItem(k));
  return purgePrivateCaches();
}

// ---------- Fetch con reintento de token ----------
// Máximo UNA renovación y UN reintento por petición ante 401, y un
// reintento ante 429 respetando Retry-After (si es razonable).
async function apiFetch(path, options = {}, attempt = { auth: false, rate: false }) {
  const gen = sessionGen;
  const token = await getAccessToken();
  if (!token || gen !== sessionGen) throw new Error('NO_TOKEN');
  const res = await trackedFetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers
    }
  });
  if (gen !== sessionGen) throw new Error('NO_TOKEN');
  if (res.status === 401) {
    if (attempt.auth) throw new Error('UNAUTHORIZED');
    const fresh = await refreshToken();
    if (!fresh) throw new Error('NO_TOKEN');
    return apiFetch(path, options, { ...attempt, auth: true });
  }
  if (res.status === 429 && !attempt.rate) {
    const wait = Number(res.headers.get('Retry-After') || 1);
    if (wait <= 5) {
      await new Promise((r) => setTimeout(r, wait * 1000));
      return apiFetch(path, options, { ...attempt, rate: true });
    }
  }
  if (res.status === 204) return null;
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Spotify ${res.status}: ${body}`);
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// ---------- Datos del usuario ----------
export const getMe = () => apiFetch('/me');
export const getPlaylists = (limit = 50) => apiFetch(`/me/playlists?limit=${limit}`);
export const getPlaylistTracks = async (playlistId) => {
  const data = await apiFetch(`/playlists/${playlistId}/tracks?limit=100`);
  return data.items.map((i) => i.track).filter(Boolean);
};
export const getTopTracks = (range = 'medium_term', limit = 50) =>
  apiFetch(`/me/top/tracks?time_range=${range}&limit=${limit}`).then((d) => d.items);
export const getTopArtists = (range = 'medium_term', limit = 30) =>
  apiFetch(`/me/top/artists?time_range=${range}&limit=${limit}`).then((d) => d.items);
export const getRecentlyPlayed = (limit = 50) =>
  apiFetch(`/me/player/recently-played?limit=${limit}`).then((d) => d.items.map((i) => i.track));
export const getArtists = (ids) =>
  apiFetch(`/artists?ids=${ids.slice(0, 50).join(',')}`).then((d) => d.artists);
export const searchTracks = (query, limit = 20) =>
  apiFetch(`/search?type=track&limit=${limit}&q=${encodeURIComponent(query)}`)
    .then((d) => d.tracks.items);
export const searchAlbums = (query, limit = 12) =>
  apiFetch(`/search?type=album&limit=${limit}&q=${encodeURIComponent(query)}`)
    .then((d) => d.albums.items);
export const searchArtists = (query, limit = 6) =>
  apiFetch(`/search?type=artist&limit=${limit}&q=${encodeURIComponent(query)}`)
    .then((d) => d.artists.items);
export const getArtistTopTracks = (artistId) =>
  apiFetch(`/artists/${artistId}/top-tracks?market=from_token`).then((d) => d.tracks);
export const getArtistAlbums = (artistId, limit = 10) =>
  apiFetch(`/artists/${artistId}/albums?include_groups=album&limit=${limit}&market=from_token`)
    .then((d) => d.items);
export const getAlbumTracks = async (albumId) => {
  const album = await apiFetch(`/albums/${albumId}`);
  // Los tracks del álbum no traen imágenes; se las inyectamos desde el álbum
  return (album.tracks?.items || []).map((t) => ({
    ...t,
    album: { id: album.id, name: album.name, images: album.images, release_date: album.release_date }
  }));
};

// Audio features: solo funciona en apps con acceso legacy. Falla en silencio.
export async function tryGetAudioFeatures(trackIds) {
  try {
    const data = await apiFetch(`/audio-features?ids=${trackIds.slice(0, 100).join(',')}`);
    return data.audio_features || [];
  } catch {
    return [];
  }
}

// ---------- Control de reproducción (Spotify Connect) ----------
export const getDevices = () => apiFetch('/me/player/devices').then((d) => d.devices);
export const transferPlayback = (deviceId, play = true) =>
  apiFetch('/me/player', { method: 'PUT', body: JSON.stringify({ device_ids: [deviceId], play }) });
export const playTracks = (uris, deviceId, positionMs = 0) =>
  apiFetch(`/me/player/play${deviceId ? `?device_id=${deviceId}` : ''}`, {
    method: 'PUT',
    body: JSON.stringify({ uris, position_ms: positionMs })
  });
export const pause = () => apiFetch('/me/player/pause', { method: 'PUT' });
export const resume = () => apiFetch('/me/player/play', { method: 'PUT' });
export const skipNext = () => apiFetch('/me/player/next', { method: 'POST' });
export const addToPlaybackQueue = (uri, deviceId) =>
  apiFetch(`/me/player/queue?uri=${encodeURIComponent(uri)}${deviceId ? `&device_id=${deviceId}` : ''}`, { method: 'POST' });
export const setRemoteVolume = (percent, deviceId) =>
  apiFetch(`/me/player/volume?volume_percent=${Math.round(percent)}${deviceId ? `&device_id=${deviceId}` : ''}`, { method: 'PUT' });
export const getPlaybackState = () => apiFetch('/me/player');
