import { useState, useEffect } from 'react';
import AuthSpotify from './components/AuthSpotify.jsx';
import DJPlayer from './components/DJPlayer.jsx';
import { getStoredToken, handleCallback, refreshToken } from './services/spotifyAPI.js';

// Detección de plataforma: PWA instalada, Electron o navegador
function detectPlatform() {
  if (window.electronAPI?.isElectron) return 'electron';
  if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone) return 'pwa';
  return 'web';
}

export default function App() {
  const [token, setToken] = useState(null);
  const [checking, setChecking] = useState(true);
  const [platform] = useState(detectPlatform);

  useEffect(() => {
    (async () => {
      try {
        // 1) ¿Venimos del callback de OAuth?
        const fromCallback = await handleCallback();
        if (fromCallback) { setToken(fromCallback); return; }
        // 2) ¿Hay token guardado o refresh válido?
        const stored = getStoredToken() || (await refreshToken());
        if (stored) setToken(stored);
      } catch (err) {
        console.error('[App] Error inicializando sesión:', err);
      } finally {
        setChecking(false);
      }
    })();
  }, []);

  if (checking) {
    return (
      <main className="min-h-screen grid place-items-center">
        <div className="flex gap-1 h-8 items-end" aria-label="Cargando">
          <span className="eq-bar h-8" /><span className="eq-bar h-8" />
          <span className="eq-bar h-8" /><span className="eq-bar h-8" />
        </div>
      </main>
    );
  }

  return token
    ? <DJPlayer platform={platform} onLogout={() => setToken(null)} />
    : <AuthSpotify platform={platform} />;
}
