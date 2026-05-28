import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 700,
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:4319',
      '/ws': { target: 'ws://localhost:4319', ws: true },
    },
  },
})
