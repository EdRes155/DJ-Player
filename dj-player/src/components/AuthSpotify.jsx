import PropTypes from 'prop-types';
import { redirectToLogin } from '../services/spotifyAPI.js';

export default function AuthSpotify({ platform }) {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      {/* Cabina del DJ: el sello visual de la app */}
      <div className="relative mb-10">
        <div className="w-40 h-40 rounded-full border-4 border-line bg-panel grid place-items-center animate-spin-slow">
          <div className="w-12 h-12 rounded-full bg-neon" />
        </div>
        <div className="absolute -bottom-2 -right-2 flex gap-1 h-10 items-end bg-ink rounded-xl p-2 border border-line">
          <span className="eq-bar h-6" /><span className="eq-bar h-6" />
          <span className="eq-bar h-6" /><span className="eq-bar h-6" />
        </div>
      </div>

      <h1 className="font-display font-800 text-4xl sm:text-5xl mb-3 tracking-tight">
        DJ <span className="text-neon">Player</span>
      </h1>
      <p className="text-mist max-w-sm mb-10 leading-relaxed">
        Tu música de Spotify, mezclada con transiciones de voz automáticas.
        Como tener tu propio DJ en cabina.
      </p>

      <button type="button" onClick={redirectToLogin} className="btn-primary w-full max-w-xs text-lg">
        Conectar con Spotify
      </button>

      <p className="text-mist/60 text-xs mt-6">
        Se requiere Spotify Premium · {platform === 'pwa' ? 'App instalada' : platform === 'electron' ? 'Windows' : 'Navegador'}
      </p>
    </main>
  );
}

AuthSpotify.propTypes = { platform: PropTypes.string.isRequired };
