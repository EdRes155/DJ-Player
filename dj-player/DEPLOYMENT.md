# Deployment

## 1. Deploy a Vercel (PWA)

```bash
npm i -g vercel
vercel            # sigue el asistente
vercel --prod
```

O conecta el repo de GitHub en vercel.com (como hiciste con tu bot de Mercado Libre) y cada push despliega solo.

**Después del deploy:**
1. En el dashboard de Spotify agrega `https://TU-APP.vercel.app/callback` como Redirect URI.
2. En Vercel → Settings → Environment Variables, agrega las mismas variables del `.env` y actualiza `VITE_SPOTIFY_REDIRECT_URI` a la URL de producción. Redeploy.

> Spotify exige HTTPS en producción; Vercel ya lo incluye.

### Activar la voz de ElevenLabs

1. En ElevenLabs → Developers → API Keys crea una key nueva. Restríngela al
   permiso **Text to Speech** y fija un límite de créditos.
2. En Voice Library elige una voz en español y copia su **Voice ID**.
3. En Vercel → Settings → Environment Variables (Production y Preview) agrega,
   **sin** prefijo `VITE_`:
   - `ELEVENLABS_API_KEY` (márcala como *Sensitive*)
   - `ELEVENLABS_VOICE_ID`
   - `ELEVENLABS_MODEL_ID` *(opcional: `eleven_multilingual_v2`, `eleven_v3`, `eleven_flash_v2_5`)*
   - `ALLOWED_SPOTIFY_USERS` con tu id de usuario de Spotify
4. Cambia `VITE_TTS_PROVIDER` a `auto` y redeploya.

¿No sabes tu id de Spotify? Deja `ALLOWED_SPOTIFY_USERS` con cualquier valor,
inicia una sesión DJ y abre la consola del navegador: el aviso
`[ElevenLabs] Tu usuario de Spotify (...)` muestra el id a agregar.

**Nunca** crees una variable `VITE_ELEVENLABS_API_KEY`: todo lo que empieza por
`VITE_` queda publicado en el JavaScript de la web. Si alguna vez lo hiciste,
revoca esa key en ElevenLabs.

**Electron:** compila con `VITE_TTS_ENDPOINT=https://TU-APP.vercel.app/api/tts`
y agrega el origen de la app a `TTS_ALLOWED_ORIGINS` si el navegador lo exige.

## 2. Instalar como PWA

**Android (Chrome):** abre la URL → menú ⋮ → "Agregar a pantalla de inicio" / "Instalar app".

**iPad (Safari):** abre la URL → botón Compartir → "Agregar a pantalla de inicio".
> En iPad la app funciona en **modo control**: abre Spotify en el iPad (o en cualquier dispositivo) para que aparezca como dispositivo activo. La voz del DJ suena desde el iPad.

## 3. Compilar .exe (Windows)

```bash
npm run build:electron
```

El instalador NSIS queda en `release/`. Si Windows SmartScreen lo bloquea (app sin firmar): "Más información" → "Ejecutar de todas formas".

## 4. Testing por plataforma

| Plataforma | Qué revisar |
|---|---|
| Chrome/Edge | Login, reproducción con SDK, transición completa con voz |
| Android Chrome | Instalación PWA, audio de voz tras primer toque (gesto requerido) |
| iPad Safari | Modo control detecta dispositivos, rampas de volumen vía API |
| Windows .exe | Login abre dentro de la app, menú y atajos (Ctrl+Q, Ctrl+R) |

## 5. Troubleshooting

| Problema | Causa probable | Solución |
|---|---|---|
| "Se requiere Premium" | Cuenta gratuita | El SDK/control de reproducción exige Premium |
| Login redirige y no pasa nada | Redirect URI no coincide | Debe ser EXACTA en el dashboard (incluye `/callback`) |
| No suena la voz del DJ | AudioContext bloqueado | La sesión debe iniciarse con un toque del usuario (ya implementado) |
| Suena la voz del navegador en lugar de ElevenLabs | `/api/tts` respondió error | Revisa en Vercel → Logs la función `api/tts`: `tts_not_configured`, `user_not_allowed` o `tts_upstream_error` (key/voz inválida o sin créditos) |
| iPad: "Abre Spotify en algún dispositivo" | No hay dispositivo Connect activo | Abre la app de Spotify y reproduce cualquier cosa 1 s |
| Volumen "a saltos" en iPad | Connect API no tiene rampas nativas | Normal: son 12 pasos por rampa; en escritorio es suave |
| 403 en /audio-features | App nueva sin acceso legacy | Esperado: el engine ya funciona sin ese endpoint |
