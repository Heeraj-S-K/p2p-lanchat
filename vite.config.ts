import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Needed so the production build works when loaded via file:// in Electron.
  base: './',
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});
