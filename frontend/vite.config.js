import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/gateway/',
  server: {
    proxy: {
      '/gateway/api': {
        target: 'http://localhost:8000',
        rewrite: (path) => path.replace(/^\/gateway/, ''),
      }
    }
  },
  build: {
    outDir: 'dist',
  }
})
