import PropTypes from 'prop-types';
import { VIBE_PRESETS } from '../services/djEngine.js';

export default function GenreSelector({ vibeId, onChange, disabled }) {
  return (
    <section className="px-6 mb-4">
      <h3 className="font-mono text-xs uppercase tracking-widest text-mist mb-3">¿Qué vibra quieres?</h3>
      <div className="flex gap-2 overflow-x-auto pb-2 -mx-6 px-6">
        {VIBE_PRESETS.map((v) => (
          <button key={v.id} type="button" disabled={disabled}
                  onClick={() => onChange(v.id)}
                  className={`chip shrink-0 ${vibeId === v.id ? 'chip-on' : 'chip-off'} disabled:opacity-40`}>
            {v.label}
          </button>
        ))}
      </div>
    </section>
  );
}

GenreSelector.propTypes = {
  vibeId: PropTypes.string.isRequired,
  onChange: PropTypes.func.isRequired,
  disabled: PropTypes.bool
};
