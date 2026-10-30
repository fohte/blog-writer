import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const offlineShell = (): Plugin => ({
  name: 'blog-writer-offline-shell',
  apply: 'build',
  generateBundle(_options, bundle) {
    const precacheUrls = [
      '/index.html',
      '/manifest.webmanifest',
      '/icons/icon.svg',
      '/icons/icon-192.png',
      '/icons/icon-512.png',
      '/apple-touch-icon.png',
      ...Object.entries(bundle)
        .filter(
          ([fileName, output]) =>
            fileName !== 'sw.js' &&
            (output.type === 'chunk' ||
              /\.(?:css|svg|png|webp|ico|woff2?)$/u.test(fileName)),
        )
        .map(([fileName]) => `/${fileName}`),
    ]
    const workerTemplate = readFileSync(
      fileURLToPath(new URL('./service-worker.js', import.meta.url)),
      'utf8',
    )
    const publicAssets = [
      './public/manifest.webmanifest',
      './public/icons/icon.svg',
      './public/icons/icon-192.png',
      './public/icons/icon-512.png',
      './public/apple-touch-icon.png',
    ]
    const buildHash = createHash('sha256')
    for (const [fileName, output] of Object.entries(bundle).sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      buildHash.update(fileName)
      buildHash.update(output.type === 'chunk' ? output.code : output.source)
    }
    for (const assetPath of publicAssets) {
      buildHash.update(readFileSync(new URL(assetPath, import.meta.url)))
    }
    buildHash.update(workerTemplate)
    const cacheName = `blog-writer-app-shell-${buildHash.digest('hex').slice(0, 12)}`
    const serviceWorker = workerTemplate
      .replaceAll("'__CACHE_NAME__'", JSON.stringify(cacheName))
      .replaceAll(
        "'__PRECACHE_URLS__'",
        JSON.stringify([...new Set(precacheUrls)]),
      )

    this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker })
  },
})

export default defineConfig({
  plugins: [tailwindcss(), react(), offlineShell()],
  optimizeDeps: {
    include: [
      '@base-ui/react/button',
      '@base-ui/react/checkbox',
      '@base-ui/react/dialog',
      '@base-ui/react/input',
      '@base-ui/react/popover',
      '@base-ui/react/select',
      '@base-ui/react/tabs',
      '@base-ui/react/tooltip',
    ],
  },
})
