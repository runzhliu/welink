import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    sourcemap: false,
  },
  server: {
    port: 3418,
    proxy: {
      '/api': 'http://localhost:8080'
    }
  }
})
