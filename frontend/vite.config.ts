import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// IMPORTANT: base must be '/' for Vercel/Netlify (served at the domain root).
// If you instead deploy to GitHub Pages under https://user.github.io/REPO/,
// set base to '/REPO/' (e.g. via VITE_BASE) so asset paths resolve.
export default defineConfig({
  base: process.env.VITE_BASE || '/',
  plugins: [react()],
  build: { outDir: 'dist', sourcemap: false },
});
