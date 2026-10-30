import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  plugins: [tailwindcss(), react()],
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
