import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/simulator': 'http://127.0.0.1:7850' } },
  build: { outDir: 'dist-controls' },
})
