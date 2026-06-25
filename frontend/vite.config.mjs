import { defineConfig } from 'vite'

// base relativa: la pagina vive en un subpath de GitHub Pages
// (santinogaldin1.github.io/app-electro-carrefour/), asi los assets resuelven bien.
export default defineConfig({
  base: './'
})
