import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'https://localhost:3000',
        secure: false,
        changeOrigin: true,
      },
      '/auth': {
        target: 'https://localhost:3000',
        secure: false,
        changeOrigin: true,
      },
      '/socket.io': {
        target: 'https://localhost:3000',
        secure: false,
        changeOrigin: true,
        ws: true,
      },
    },
  },
})
