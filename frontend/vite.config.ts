import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base must be '/' for Vercel (served at the domain root).
export default defineConfig({
  base: '/',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
});