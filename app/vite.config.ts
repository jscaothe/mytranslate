import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Tauri expects a fixed dev port and its own log output in the terminal.
  clearScreen: false,
  server: { port: 5173, strictPort: true },
  // The E2E server runs beside `tauri dev`; its own dependency cache keeps the two from blocking each other.
  cacheDir: process.env.VITE_CACHE_DIR ?? 'node_modules/.vite',
})
