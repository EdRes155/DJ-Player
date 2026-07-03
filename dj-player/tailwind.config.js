/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: '#0a0a0f',
        panel: '#141419',
        line: '#26262e',
        neon: { DEFAULT: '#a855f7', soft: '#c084fc', deep: '#7c3aed' },
        mist: '#9b9ba6'
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', 'system-ui', 'sans-serif'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', 'monospace']
      },
      animation: {
        'spin-slow': 'spin 8s linear infinite',
        'pulse-bars': 'bars 1.1s ease-in-out infinite'
      },
      keyframes: {
        bars: {
          '0%,100%': { transform: 'scaleY(0.35)' },
          '50%': { transform: 'scaleY(1)' }
        }
      }
    }
  },
  plugins: []
};
