import { useState, useRef } from 'react';
import PropTypes from 'prop-types';
import { searchTracks, searchAlbums, searchArtists, getAlbumTracks, getArtistTopTracks } from '../services/spotifyAPI.js';

// Fila de resultado con dos acciones: reproducir ya (▶) o agregar a la cola (＋)
function ResultRow({ image, title, subtitle, onPlay, onAdd, busy }) {
  return (
    <li className="animate-fadein">
      <div className="flex items-center gap-3 py-2 px-2 rounded-xl hover:bg-line transition-colors">
        <img src={image} alt="" loading="lazy" className="w-11 h-11 rounded object-cover shrink-0" />
        <div className="min-w-0 flex-1">
          <span className="block text-sm truncate">{title}</span>
          <span className="block text-xs text-mist truncate">{subtitle}</span>
        </div>
        <button type="button" onClick={onPlay} disabled={busy} aria-label={`Reproducir ${title}`}
                className="w-10 h-10 rounded-full bg-neon hover:bg-neon-deep active:scale-90 transition-all grid place-items-center shrink-0 disabled:opacity-40">
          ▶
        </button>
        <button type="button" onClick={onAdd} disabled={busy} aria-label={`Agregar ${title} a la cola`}
                className="w-10 h-10 rounded-full border border-line hover:border-neon-soft active:scale-90 transition-all grid place-items-center shrink-0 text-lg disabled:opacity-40">
          ＋
        </button>
      </div>
    </li>
  );
}

ResultRow.propTypes = {
  image: PropTypes.string, title: PropTypes.string.isRequired, subtitle: PropTypes.string,
  onPlay: PropTypes.func.isRequired, onAdd: PropTypes.func.isRequired, busy: PropTypes.bool
};

export default function SearchBar({ onPlayTracks, onAddTracks, disabled }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [tracks, setTracks] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [artists, setArtists] = useState([]);
  const [toast, setToast] = useState('');
  const toastTimer = useRef(null);

  const showToast = (msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2200);
  };

  const runSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setOpen(true);
    try {
      const [t, a, ar] = await Promise.all([
        searchTracks(query, 6),
        searchAlbums(query, 4),
        searchArtists(query, 4)
      ]);
      setTracks(t); setAlbums(a); setArtists(ar);
    } catch (err) {
      console.error('[Search] error:', err);
    } finally {
      setLoading(false);
    }
  };

  // Resuelve las canciones de un artista (top 10) o de un álbum completo
  const resolveArtist = async (artist) => (await getArtistTopTracks(artist.id)).slice(0, 10);
  const resolveAlbum = (album) => getAlbumTracks(album.id);

  const doPlay = async (resolver) => {
    setBusy(true);
    try {
      const list = await resolver();
      if (list.length) { onPlayTracks(list); setOpen(false); }
    } catch (err) { console.error('[Search] play error:', err); }
    finally { setBusy(false); }
  };

  const doAdd = async (resolver, label) => {
    setBusy(true);
    try {
      const list = await resolver();
      if (list.length) { onAddTracks(list); showToast(`＋ ${label} en la cola`); }
    } catch (err) { console.error('[Search] add error:', err); }
    finally { setBusy(false); }
  };

  return (
    <section className="px-6 mb-4 relative">
      <div className="flex gap-2">
        <input
          type="text" value={query} disabled={disabled}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && runSearch()}
          placeholder="Buscar canción, artista o álbum…"
          className="flex-1 bg-panel border border-line rounded-2xl px-4 py-3 min-h-[50px]
                     text-white placeholder:text-mist transition-colors focus:border-neon-soft
                     focus-visible:outline focus-visible:outline-2 focus-visible:outline-neon-soft disabled:opacity-40"
        />
        <button type="button" onClick={runSearch} disabled={disabled} className="btn-primary w-14" aria-label="Buscar">
          🔍
        </button>
      </div>

      {toast && (
        <div className="absolute left-1/2 -translate-x-1/2 top-full mt-2 z-20 bg-neon text-white
                        text-sm font-medium rounded-full px-4 py-2 shadow-lg animate-fadein">
          {toast}
        </div>
      )}

      {open && (
        <div className="mt-3 bg-panel border border-line rounded-2xl p-3 max-h-96 overflow-y-auto animate-fadein">
          <div className="flex justify-between items-center mb-2">
            <span className="font-mono text-[10px] uppercase tracking-widest text-mist">
              ▶ reproducir ya · ＋ agregar a la cola
            </span>
            <button type="button" onClick={() => setOpen(false)} className="text-mist text-sm hover:text-white transition-colors">✕</button>
          </div>

          {loading && (
            <div className="py-6 flex justify-center gap-1 h-12 items-end">
              <span className="eq-bar h-8" /><span className="eq-bar h-8" />
              <span className="eq-bar h-8" /><span className="eq-bar h-8" />
            </div>
          )}

          {!loading && artists.length > 0 && (
            <>
              <p className="text-neon-soft text-xs font-semibold mb-1">Artistas</p>
              <ul className="mb-3">
                {artists.map((a) => (
                  <ResultRow key={a.id} busy={busy}
                    image={a.images?.[2]?.url || a.images?.[0]?.url}
                    title={a.name} subtitle="artista · sus 10 más escuchadas"
                    onPlay={() => doPlay(() => resolveArtist(a))}
                    onAdd={() => doAdd(() => resolveArtist(a), a.name)} />
                ))}
              </ul>
            </>
          )}

          {!loading && tracks.length > 0 && (
            <>
              <p className="text-neon-soft text-xs font-semibold mb-1">Canciones</p>
              <ul className="mb-3">
                {tracks.map((t) => (
                  <ResultRow key={t.id} busy={busy}
                    image={t.album?.images?.[2]?.url || t.album?.images?.[0]?.url}
                    title={t.name} subtitle={t.artists?.map((x) => x.name).join(', ')}
                    onPlay={() => doPlay(async () => [t])}
                    onAdd={() => doAdd(async () => [t], t.name)} />
                ))}
              </ul>
            </>
          )}

          {!loading && albums.length > 0 && (
            <>
              <p className="text-neon-soft text-xs font-semibold mb-1">Álbumes</p>
              <ul>
                {albums.map((a) => (
                  <ResultRow key={a.id} busy={busy}
                    image={a.images?.[2]?.url || a.images?.[0]?.url}
                    title={a.name}
                    subtitle={`${a.artists?.map((x) => x.name).join(', ')} · álbum completo`}
                    onPlay={() => doPlay(() => resolveAlbum(a))}
                    onAdd={() => doAdd(() => resolveAlbum(a), a.name)} />
                ))}
              </ul>
            </>
          )}

          {!loading && !tracks.length && !albums.length && !artists.length && (
            <p className="text-mist text-sm py-4 text-center">Sin resultados para "{query}"</p>
          )}
        </div>
      )}
    </section>
  );
}

SearchBar.propTypes = {
  onPlayTracks: PropTypes.func.isRequired,
  onAddTracks: PropTypes.func.isRequired,
  disabled: PropTypes.bool
};
