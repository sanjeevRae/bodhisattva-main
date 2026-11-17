import { defineConfig } from 'vite'
import path from 'path'
import { fileURLToPath } from 'url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '')
        return path.resolve(__dirname, 'src/assets', filename)
      }
    },
  }
}

export default defineConfig({
  plugins: [
    figmaAssetResolver(),
    react(),
    tailwindcss(),
  ],

  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },

  // ARCHITECTURE.md §5.1: the browser sees a single origin — /api is
  // proxied to the API server on :4000 in dev and in `vite preview`
  // (preview does not inherit `server.proxy`, so it is repeated there).
  server: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },

  preview: {
    proxy: {
      '/api': 'http://localhost:4000',
    },
  },

  assetsInclude: ['**/*.svg', '**/*.csv'],
})