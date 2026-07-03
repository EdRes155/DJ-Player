# 🎵 DJ Player

Reproductor DJ automático multi-plataforma: toma tu música de Spotify, arma un set con arco de energía, agrega **descubrimientos basados en tu música** y presenta cada canción con **voz sintetizada entre cada track** (estilo DJ Livi de Spotify).

**Plataformas:** Android + iPad (PWA), Windows (Electron .exe), navegador.

---

## ⚠️ Léeme primero: realidades de la API de Spotify (2026)

1. **Se requiere Spotify Premium** para controlar la reproducción de canciones completas. No hay forma legal de evitarlo.
2. **Spotify deprecó** `/audio-features` (BPM, energy, key), `/recommendations` y `preview_url` para apps creadas después de nov-2024. Por eso:
   - La energía de cada canción se **infiere** de géneros del artista + popularidad + año (`djEngine.js`). Si tu app tiene acceso legacy, se usan los features reales automáticamente.
   - Las recomendaciones se construyen con **tus top artists + búsqueda por género**, no con el endpoint deprecado.
3. **El audio de Spotify tiene DRM**: no se puede mezclar su PCM con Web Audio API. La transición funciona como el DJ real de Spotify: rampa de volumen ↓ → voz DJ local encima → siguiente track ↑. `audioMixer.js` orquesta esa coreografía.
4. **iPad/iOS**: el Web Playback SDK no corre en Safari iOS. Ahí la app entra en **modo control**: maneja tu app de Spotify vía Connect API (la voz DJ suena desde el iPad, la música desde el dispositivo activo).

## Funciones

- 🎚️ **Selector de vibra**: Automático, Fiesta, Chill, Rock, Hip-Hop, Regional.
- 🧠 **Set con arco de energía**: apertura media → clímax → cierre suave.
- 🎙️ **DJ entre cada canción** con guiones coherentes: menciona el artista y la canción que sigue, si la energía sube o baja, si repite artista, la época del track y la hora del día (`djScript.js`). Nunca repite frases seguidas.
- ✨ **Descubrimientos**: intercala 1 canción sugerida cada 3, basada en tus top artists y géneros (con etiqueta "sugerida" y presentación especial del DJ).
- 📱 PWA instalable + 🪟 .exe de Windows con la misma codebase.

## Setup

```bash
npm install
cp .env.example .env      # llena tus credenciales
npm run dev               # http://localhost:5173
```

### Credenciales

| Variable | Dónde conseguirla |
|---|---|
| `VITE_SPOTIFY_CLIENT_ID` | [developer.spotify.com/dashboard](https://developer.spotify.com/dashboard) → Create app. Agrega `http://localhost:5173/callback` como Redirect URI y activa **Web Playback SDK** + **Web API** |
| `VITE_SPOTIFY_REDIRECT_URI` | `http://localhost:5173/callback` en dev |
| `VITE_ELEVENLABS_API_KEY` | [elevenlabs.io](https://elevenlabs.io) → Profile → API Keys (plan gratis alcanza para probar) |
| `VITE_ELEVENLABS_VOICE_ID` | Voice Library → elige una voz conversational en español → copia el ID |
| `VITE_LLM_API_URL` | *(opcional)* endpoint propio que genere guiones DJ con un LLM; vacío = plantillas locales |

## Scripts

```bash
npm run dev              # desarrollo web
npm run build            # build de producción (PWA incluida)
npm run preview          # previsualizar el build
npm run electron:dev     # desarrollo con ventana de Electron
npm run build:electron   # genera el .exe en /release
```

## Estructura

```
src/
├── components/        # DJPlayer, NowPlaying, Queue, GenreSelector, AuthSpotify
├── hooks/
│   └── useSpotifyPlayer.js   # SDK (escritorio) + Connect (iPad/fallback)
└── services/
    ├── spotifyAPI.js         # OAuth PKCE + datos + control de reproducción
    ├── elevenLabsAPI.js      # TTS con cache
    ├── audioMixer.js         # rampas de volumen + voz encima
    ├── djEngine.js           # energía, arco del set, recomendaciones
    └── djScript.js           # guiones coherentes del DJ
```

## Cómo funciona la transición (entre CADA canción)

```
t = duración - 20 s → se prepara el guion y la voz (sin latencia en vivo)
t = duración - 4 s:
  1. Fade out del track actual (2 s, curva de igual potencia)
  2. Arranca el siguiente track al 35 % de volumen
  3. La voz del DJ presenta la canción encima del intro
  4. Fade in a volumen normal (2 s)
```

Consulta `DEPLOYMENT.md` para deploy en Vercel, instalación como PWA y compilación del .exe.
