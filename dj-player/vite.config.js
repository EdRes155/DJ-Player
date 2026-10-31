import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  base: './',
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['icons/*.png'],
      manifest: {
        name: 'DJ Player',
        short_name: 'DJ Player',
        description: 'Tu DJ personal con transiciones de voz automáticas',
        theme_color: '#a855f7',
        background_color: '#0a0a0f',
        display: 'standalone',
        start_url: './',
        icons: [
          { src: 'icons/icon-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: 'icons/maskable-icon.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ],
        screenshots: [
          { src: 'screenshots/narrow.png', sizes: '540x720', type: 'image/png', form_factor: 'narrow' },
          { src: 'screenshots/wide.png', sizes: '1280x720', type: 'image/png', form_factor: 'wide' }
        ]
      },
      workbox: {
        // /api/* son funciones del servidor: nunca devolver index.html por ellas
        navigateFallbackDenylist: [/^\/api\//],
        // Sin caché para api.spotify.com ni para /api/tts: son datos personales
        // de la cuenta (historial, playlists, gustos) y no deben quedar en disco.
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/i\.scdn\.co\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'spotify-images', expiration: { maxAgeSeconds: 604800, maxEntries: 200 } }
          }
        ]
      }
    })
  ],
  server: { host: '127.0.0.1', port: 5173, open: true },
  build: {
    rollupOptions: {
      output: {
        manualChunks: { vendor: ['react', 'react-dom'] }
      }
    }
  }
});
