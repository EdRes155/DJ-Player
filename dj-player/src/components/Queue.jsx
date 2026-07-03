import PropTypes from 'prop-types';

export default function Queue({ tracks, currentIndex, onJump, jumping }) {
  const upcoming = tracks.slice(currentIndex + 1, currentIndex + 21);
  if (!upcoming.length) return null;

  return (
    <section className="mt-8 px-6">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-mono text-xs uppercase tracking-widest text-mist">A continuación</h3>
        <span className="text-[10px] text-mist/70">toca una para adelantar</span>
      </div>
      <ul className="flex gap-3 overflow-x-auto pb-3 -mx-6 px-6 snap-x scroll-smooth">
        {upcoming.map((t, i) => {
          const realIndex = currentIndex + 1 + i;
          return (
            <li key={`${t.id}-${realIndex}`} className="shrink-0 w-32 snap-start animate-fadein">
              <button type="button" disabled={jumping}
                      onClick={() => onJump(realIndex)}
                      aria-label={`Adelantar hasta ${t.name}`}
                      className="group text-left w-full disabled:opacity-50">
                <div className="relative mb-2">
                  <img src={t.album?.images?.[1]?.url || t.album?.images?.[0]?.url}
                       alt="" loading="lazy"
                       className="w-32 h-32 rounded-2xl object-cover border border-line
                                  transition-all group-hover:border-neon-soft group-hover:scale-[1.03] group-active:scale-95" />
                  <span className="absolute inset-0 rounded-2xl grid place-items-center
                                   bg-ink/0 group-hover:bg-ink/50 transition-colors">
                    <span className="opacity-0 group-hover:opacity-100 transition-opacity
                                     w-11 h-11 rounded-full bg-neon grid place-items-center text-white">▶</span>
                  </span>
                  <span className="absolute top-1.5 left-1.5 bg-ink/80 backdrop-blur rounded-full
                                   px-2 py-0.5 font-mono text-[10px] text-mist">
                    {i + 1}
                  </span>
                </div>
                <p className="text-sm font-medium leading-tight line-clamp-2 group-hover:text-neon-soft transition-colors">{t.name}</p>
                <p className="text-xs text-mist line-clamp-1">{t.artists?.[0]?.name}</p>
                {t.isRecommendation && (
                  <span className="inline-block mt-1 text-[10px] font-mono text-neon-soft border border-neon/40 rounded-full px-2 py-0.5">
                    sugerida
                  </span>
                )}
                {t.recReason && (
                  <p className="text-[10px] text-mist/80 mt-1 line-clamp-2 leading-tight">{t.recReason}</p>
                )}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

Queue.propTypes = {
  tracks: PropTypes.array.isRequired,
  currentIndex: PropTypes.number.isRequired,
  onJump: PropTypes.func.isRequired,
  jumping: PropTypes.bool
};
