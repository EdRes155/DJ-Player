# Auditoría de DJ Player

Fecha: 31 de octubre de 2026. Repositorio: EdRes155/DJ-Player. Revisión: `841597afe3995299c67d8f73ae83a64c4a1ab118`. Web: https://dj-player-mu.vercel.app

## Dictamen y alcance

La web pública responde HTTP 200 y la aplicación compila, pero hay fallos de continuidad de reproducción, recuperación y cierre de sesión que conviene corregir antes de considerarla estable. La auditoría se realizó sin modificar el código de la aplicación; este documento registra los resultados de la revisión indicada.

Se revisaron los archivos fuente, el HTML y los assets publicados, la configuración PWA, las dependencias y varias rutas de ejecución con respuestas simuladas. Las pruebas con mocks usan el código real y datos sintéticos: no equivalen a una prueba de reproducción con una cuenta Spotify Premium. No se ha realizado un pentest exhaustivo, ni medido Core Web Vitals en condiciones reales.

Prioridad alta: corregir antes de ampliar uso. Media: corregir en el próximo ciclo. Baja: mantenimiento o mejora de menor impacto.

## Hallazgos prioritarios

### F01 — Alta: inicio bloqueado en iPhone/iPad cuando no hay un dispositivo Spotify disponible

**Evidencia:** [useSpotifyPlayer.js:39](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/hooks/useSpotifyPlayer.js#L39), [líneas 112–115](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/hooks/useSpotifyPlayer.js#L112), [DJPlayer.jsx:374](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/components/DJPlayer.jsx#L374) y [391](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/components/DJPlayer.jsx#L391).

El modo Connect establece `ready=false` cuando la lista de dispositivos está vacía. No programa una nueva búsqueda. El botón de inicio queda deshabilitado y «Buscar dispositivos otra vez» solo aparece dentro de un bloque de error que esta ruta no activa. Abrir Spotify posteriormente no desbloquea la pantalla por sí solo.

**Reproducción:** módulo del hook con navegador iOS y `getDevices()=[]`: `ready=false`, sin temporizador de redetección. **Corrección:** mostrar instrucciones y reintento siempre que Connect no esté listo; repetir detección al recuperar foco y gestionar errores de conexión en la interfaz.

### F02 — Media: la cola visible puede superar la cola enviada a Spotify

**Evidencia:** [DJPlayer.jsx:106](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/components/DJPlayer.jsx#L106) y [179–182](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/components/DJPlayer.jsx#L179).

El set puede contener más de 50 canciones, pero `kickoff` envía únicamente `set.slice(0,50)`. Todas las transiciones consecutivas usan `next()`; no cargan el bloque siguiente cuando se agota el primero. La canción 51 que anuncia la app no está garantizada en la cola de Spotify. También afecta a la continuidad en segundo plano.

**Validación:** seguimiento directo del flujo en el código, sin sesión real de Spotify. **Corrección:** llevar un registro del bloque enviado y ampliarlo o cargar el siguiente antes de agotarlo. Probar sesiones de más de 50 canciones, saltos y cambios externos de pista.

### F03 — Media: una renovación pendiente restaura las credenciales después de «Salir»

**Evidencia:** [spotifyAPI.js:101–117](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/services/spotifyAPI.js#L101) y [126–127](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/services/spotifyAPI.js#L126).

`logout()` elimina el almacenamiento, pero un `refreshToken()` iniciado antes puede terminar después y volver a ejecutar `saveTokens()`. Al recargar, la aplicación vuelve a encontrar una sesión válida.

**Reproducido:** el almacenamiento queda vacío al salir y recupera `sp_token`, `sp_refresh` y `sp_expires` al resolver la petición simulada pendiente. **Corrección:** invalidar las operaciones de una sesión cerrada mediante un identificador de generación, cancelar peticiones pendientes y centralizar la renovación para evitar concurrencia.

### F04 — Media: cerrar sesión no libera correctamente el reproductor

**Evidencia:** [useSpotifyPlayer.js:39–41](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/hooks/useSpotifyPlayer.js#L39), [83](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/hooks/useSpotifyPlayer.js#L83) y [99–111](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/hooks/useSpotifyPlayer.js#L99).

La rama iOS sale del efecto sin función de limpieza y deja vivo el sondeo de reproducción. En SDK la limpieza borra un intervalo, pero no ejecuta `player.disconnect()`. Se pueden acumular reproductores y tareas al entrar y salir repetidamente.

**Reproducido:** el intervalo iOS sobrevive al desmontaje; el mock SDK no recibe `disconnect()`. **Corrección:** cleanup común, desconexión SDK y cancelación de inicializaciones pendientes.

### F05 — Media: datos personales de Spotify se conservan en caché tras salir

**Evidencia:** [vite.config.js:34–36](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/vite.config.js#L34) y [spotifyAPI.js:126](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/services/spotifyAPI.js#L126). La misma regla está presente en el `sw.js` publicado.

La regla `NetworkFirst` abarca todos los GET de Spotify y conserva respuestas durante una hora en `spotify-api`, incluidas rutas de historial, preferencias y playlists. El cierre de sesión no purga CacheStorage.

**Límite de la conclusión:** se confirma el diseño de persistencia, no una filtración entre cuentas. La reutilización entre usuarios depende también de los encabezados de respuesta de Spotify, incluido `Vary`, no comprobados con cuenta real. **Corrección:** excluir endpoints personales del almacenamiento offline o aislar cachés por usuario y eliminarlas al salir.

### F06 — Media: renovación ilimitada ante un 401 persistente

**Evidencia:** [spotifyAPI.js:142–145](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/services/spotifyAPI.js#L142).

Tras un 401 y un refresh satisfactorio, `apiFetch` se invoca otra vez sin límite. Si el endpoint continúa rechazando la autorización, la operación no termina y genera tráfico repetido.

**Reproducido:** un único `getMe()` produjo 5 solicitudes al recurso y 4 renovaciones antes del corte explícito de la prueba. **Corrección:** una renovación y un reintento como máximo; después invalidar sesión o presentar un error recuperable.

### F07 — Media: la voz local puede bloquear el DJ con el volumen reducido

**Evidencia:** [localTTS.js:9–14](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/services/localTTS.js#L9), [34](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/services/localTTS.js#L34) y [DJPlayer.jsx:110–115](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/components/DJPlayer.jsx#L110).

Cuando `getVoices()` devuelve vacío y nunca llega `voiceschanged`, la promesa no termina. La apertura ya ha bajado el volumen al 35 % antes de esperar la locución. No hay timeout ni restauración en un bloque `finally`.

**Reproducido:** promesa pendiente con síntesis simulada sin voces. **Corrección:** limitar la espera, continuar sin voz si falla y restaurar siempre el volumen y estado visual.

### F08 — Media: una búsqueda antigua sobrescribe resultados recientes

**Evidencia:** [SearchBar.jsx:50–65](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/components/SearchBar.jsx#L50), [96–102](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/components/SearchBar.jsx#L96).

Se permiten varias peticiones simultáneas y todas escriben el estado al terminar. Si la primera responde más tarde, sus resultados aparecen bajo el texto de la segunda consulta. Además, los fallos solo se registran en consola.

**Reproducido:** búsqueda nueva rápida muestra «nueva»; respuesta antigua tardía cambia la lista a «vieja». **Corrección:** usar un identificador de petición o cancelación y aceptar solo la respuesta vigente; mostrar errores al usuario.

### F09 — Media: barreras de accesibilidad

**Evidencia:** [index.css:15–29](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/index.css#L15), [tailwind.config.js:7–11](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/tailwind.config.js#L7), [NowPlaying.jsx:50](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/components/NowPlaying.jsx#L50), [GenreSelector.jsx:10](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/components/GenreSelector.jsx#L10).

Blanco sobre violeta `#a855f7` da aproximadamente **3,96:1**, por debajo de 4,5:1 exigido para texto normal. El aviso de Spotify Premium con opacidad 60 % baja a aproximadamente **3,22:1**. La barra de progreso carece de nombre accesible; la selección de vibra no expone `aria-pressed` o semántica equivalente; avisos dinámicos no tienen región viva.

**Corrección:** ajustar colores y opacidades, nombrar progreso, expresar selección y anunciar mensajes relevantes. Ratios calculados a partir de colores CSS; no se afirma conformidad WCAG integral.

### F10 — Media: dependencias de desarrollo y escritorio con avisos de seguridad

**Evidencia:** `package-lock.json` de la revisión auditada y las salidas de `npm audit --package-lock-only --json` y `npm audit --omit=dev --package-lock-only --json`, obtenidas durante la auditoría. Los archivos JSON auxiliares no se incluyen en este commit.

`npm audit --package-lock-only` informa **55 entradas de paquetes afectados: 2 críticas, 27 altas, 23 moderadas y 3 bajas**. Las críticas corresponden a `shell-quote` y `tar`. También hay avisos para Electron, Vite y herramientas de compilación.

**Distinción importante:** `npm audit --omit=dev --package-lock-only` devuelve **0**. El recuento completo no demuestra 55 vulnerabilidades explotables en la web estática; afecta a la cadena de herramientas y, en su caso, a la aplicación Electron. **Corrección:** actualizar dependencias con revisión de cambios incompatibles y repetir build, empaquetado y pruebas. No aplicar automáticamente sugerencias destructivas de `audit fix --force`.

### F11 — Alta si se activa ElevenLabs: publicación de una clave secreta en el cliente

**Evidencia:** [elevenLabsAPI.js:6](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/services/elevenLabsAPI.js#L6) y [27–30](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/services/elevenLabsAPI.js#L27).

La integración lee `VITE_ELEVENLABS_API_KEY` y envía `xi-api-key` desde el navegador. Al compilar con ese proveedor, la clave queda accesible al cliente y puede utilizarse para consumir cuota.

**Estado actual:** el bundle publicado inspeccionado no contiene el endpoint de ElevenLabs ni `xi-api-key`; **no se ha encontrado una clave de ElevenLabs expuesta en ese bundle**. El hallazgo es una condición insegura al activar la integración. **Corrección:** pasar TTS por un backend autenticado con secreto solo de servidor y límites de uso; rotar claves si se publicaron en versiones previas.

## Otros problemas

- **Desbordamiento móvil del buscador:** con los assets publicados reproducidos en Chromium, viewport de 320 px y fuentes de respaldo (Google Fonts bloqueadas), el documento mide **353 px** de ancho. A 390 y 768 px no se observó desbordamiento. [SearchBar.jsx:98](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/components/SearchBar.jsx#L98) usa `flex-1` sin `min-w-0` en el input. Añadir `min-w-0` y fijar el encogimiento del botón; validar también con las fuentes web cargadas. La captura auxiliar se generó durante la auditoría y no se incluye en este commit.
- **Progreso visual discontinuo:** [useSpotifyPlayer.js:55–62](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/hooks/useSpotifyPlayer.js#L55) actualiza la posición visual solo con eventos SDK; [150–155](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/hooks/useSpotifyPlayer.js#L150) consulta la posición real sin reflejarla en estado. Reproducción simulada: 20.000 ms consultados frente a 10.000 ms en UI. Actualizar estado o interpolar el progreso.
- **No hay acción para terminar una sesión DJ conservando la sesión Spotify:** [DJPlayer.jsx:358–404](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/src/components/DJPlayer.jsx#L358). Los selectores siguen bloqueados al pausar. Añadir «Terminar sesión DJ» con cancelación y restauración de estado.
- **Orientación PWA forzada a vertical:** [vite.config.js:19](https://github.com/EdRes155/DJ-Player/blob/841597afe3995299c67d8f73ae83a64c4a1ab118/dj-player/vite.config.js#L19). Omitir la restricción si no existe una necesidad funcional.
- **Lint roto:** `npm run lint` termina con código 2 porque ESLint 9 no encuentra `eslint.config.js/mjs/cjs`. Añadir configuración compatible con JSX y React/hooks. No hay pruebas automatizadas ni CI en el árbol revisado.
- **Endurecimiento HTTP pendiente:** la respuesta HTML inspeccionada incluye HSTS, pero no CSP, `X-Content-Type-Options`, `Referrer-Policy` ni restricciones de framing. Conviene configurar una política compatible con Spotify y los recursos externos. Su ausencia por sí sola no demuestra XSS.

## Validación y rendimiento

- HTTP 200 del despliegue, HTML, JS, CSS, manifiesto y service worker inspeccionados.
- Instalación reproducible de dependencias con `npm ci --ignore-scripts`; scripts de instalación de terceros omitidos.
- `npm run build`: correcto. Compilación sin credenciales de producción.
- `npm run lint`: falla por configuración ausente.
- Auditorías npm completa y sin dependencias de desarrollo: 55 y 0, respectivamente.
- Pruebas locales de auth, hook, voz y búsqueda con resultados reproducidos. Los scripts temporales y las capturas se generaron durante la sesión de auditoría y no forman parte de este commit; las condiciones y los resultados se describen en los hallazgos.
- Renderizado del bundle publicado en Chromium mediante replay local de recursos, con Service Worker desactivado, fuentes de respaldo y respuestas Spotify simuladas. En modo iOS sin dispositivos se confirmó en la UI el botón de inicio deshabilitado y la ausencia de reintento. Esto no sustituye una prueba en Safari/iPhone real.
- Los dos archivos JS publicados suman aproximadamente **187 kB sin comprimir**; el CSS, **18,7 kB**. La compilación local genera aproximadamente **61,7 kB de JS gzip**. Esto no mide tiempo de carga ni fluidez reales.
- En Connect hay un sondeo por segundo y las transiciones realizan múltiples cambios de volumen remotos. Conviene medir el volumen de peticiones, tratar 429/Retry-After y reducir trabajo mientras esté pausado; no se ha demostrado saturación de cuota en producción.

## Aspectos correctos

OAuth utiliza PKCE S256 y no necesita un secreto de cliente Spotify en el navegador. La UI usa React sin `dangerouslySetInnerHTML`. Electron desactiva integración Node en el renderer y habilita aislamiento de contexto. La web declara idioma español y viewport, utiliza botones nativos y etiquetas en varios controles, y dispone de manifiesto y service worker para PWA; no se verificó la instalación en dispositivos reales.

## Orden de corrección sugerido

1. Recuperación de Connect, continuidad de colas largas y cierre completo de sesión/reproductor.
2. Renovación de tokens, exclusión de datos privados de caché y tolerancia a fallos de voz.
3. Carrera de búsqueda, controles accesibles y progreso visual.
4. Configuración lint, pruebas de regresión y actualización de dependencias.
5. Backend de TTS antes de activar ElevenLabs.

Pruebas de aceptación pendientes con cuenta real: OAuth completo, Spotify Premium, iOS/Safari real, sesiones superiores a 50 canciones, cambios de dispositivo, app en segundo plano y recuperación después de pérdida de red.

