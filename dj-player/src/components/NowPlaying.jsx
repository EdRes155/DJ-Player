import PropTypes from 'prop-types';

function msToTime(ms) {
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function NowPlaying({ track, position, duration, djTalking }) {
  if (!track) {
    return (
      <section className="text-center py-16 text-mist">
        <p>Elige una vibra y presiona <span className="text-white font-semibold">Iniciar sesión DJ</span></p>
      </section>
    );
  }
  const progress = duration ? Math.min(100, (position / duration) * 100) : 0;
  const art = track.album?.images?.[0]?.url;

  return (
    <section className="flex flex-col items-center px-6">
      <div className="relative w-full max-w-sm aspect-square mb-6">
        {art ? (
          <img key={track.id} src={art} alt={`Portada de ${track.album?.name}`} loading="lazy"
               className="w-full h-full object-cover rounded-3xl shadow-2xl shadow-neon/20 animate-fadein" />
        ) : (
          <div className="w-full h-full rounded-3xl bg-panel" />
        )}
        {djTalking && (
          <div className="absolute inset-x-0 bottom-0 rounded-b-3xl bg-ink/80 backdrop-blur px-4 py-3 flex items-center gap-3">
            <div className="flex gap-1 h-5 items-end shrink-0">
              <span className="eq-bar h-5" /><span className="eq-bar h-5" />
              <span className="eq-bar h-5" /><span className="eq-bar h-5" />
            </div>
            <p className="text-sm text-neon-soft font-medium">El DJ está hablando…</p>
          </div>
        )}
      </div>

      <h2 className="font-display font-bold text-2xl text-center leading-tight mb-1">{track.name}</h2>
      <p className="text-mist mb-1">{track.artists?.map((a) => a.name).join(', ')}</p>
      {track.dj && (
        <p className="font-mono text-xs text-neon-soft/80 mb-5">
          energía {Math.round(track.dj.energy * 100)}%
          {track.dj.bpm ? ` · ${track.dj.bpm} BPM` : ''}
          {track.dj.year ? ` · ${track.dj.year}` : ''}
        </p>
      )}

      <div className="w-full max-w-sm">
        <div className="h-1.5 bg-line rounded-full overflow-hidden" role="progressbar"
             aria-valuenow={Math.round(progress)} aria-valuemin={0} aria-valuemax={100}>
          <div className="h-full bg-neon rounded-full transition-[width] duration-500"
               style={{ width: `${progress}%` }} />
        </div>
        <div className="flex justify-between font-mono text-xs text-mist mt-1.5">
          <span>{msToTime(position)}</span>
          <span>{msToTime(duration)}</span>
        </div>
      </div>
    </section>
  );
}

NowPlaying.propTypes = {
  track: PropTypes.object,
  position: PropTypes.number.isRequired,
  duration: PropTypes.number.isRequired,
  djTalking: PropTypes.bool.isRequired
};
