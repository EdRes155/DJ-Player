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
        orientation: 'portrait',
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
        runtimeCaching: [
          {
            urlPattern: /^https:\/\/api\.spotify\.com\/.*/,
            handler: 'NetworkFirst',
            options: { cacheName: 'spotify-api', expiration: { maxAgeSeconds: 3600 } }
          },
          {
            urlPattern: /^https:\/\/i\.scdn\.co\/.*/,
            handler: 'CacheFirst',
            options: { cacheName: 'spotify-images', expiration: { maxAgeSeconds: 604800, maxEntries: 200 } }
          },
          {
            urlPattern: /^https:\/\/api\.elevenlabs\.io\/.*/,
            handler: 'NetworkFirst',
            options: { cacheName: 'tts-audio', expiration: { maxAgeSeconds: 86400 } }
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
