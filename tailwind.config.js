/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        accent: 'var(--primary-color)',
        'accent-glow': 'var(--primary-glow)',
        'theme-bg': 'var(--bg-color)',
        'theme-surface': 'var(--surface-color)',
        'text-main': 'var(--text-main)',
        'text-dim': 'var(--text-dim)',
        'theme-border': 'var(--border-color)',
        'theme-input': 'var(--input-bg)',
      },
      boxShadow: {
        'accent-glow': '0 0 15px var(--primary-glow)',
      }
    },
  },
  plugins: [],
};
