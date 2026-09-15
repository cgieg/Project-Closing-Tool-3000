import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { viteSingleFile } from 'vite-plugin-singlefile'
import type { Plugin } from 'vite'

/**
 * Ersetzt den Vite-Preload-Platzhalter in der fertigen Datei.
 *
 * vite-plugin-singlefile inlint alles in eine HTML-Datei, laesst dabei aber
 * `__VITE_PRELOAD__` stehen. Jeder dynamische import() wirft dann zur Laufzeit
 * "__VITE_PRELOAD__ is not defined".
 *
 * `define` allein reicht nicht: in vorgebuendelten Abhaengigkeiten - hier die
 * optionalen jsPDF-Pfade zu html2canvas, DOMPurify und canvg - steckt der
 * Platzhalter bereits im vorverarbeiteten Code. Ein leeres Abhaengigkeits-Array
 * ist die richtige Antwort, denn in einer Single-File-Ausgabe ist alles schon da.
 */
function replacePreloadPlaceholder(): Plugin {
  return {
    name: 'replace-vite-preload-placeholder',
    enforce: 'post',
    generateBundle(_options, bundle) {
      Object.values(bundle).forEach(file => {
        if (file.type === 'asset' && typeof file.source === 'string') {
          file.source = file.source.replaceAll('__VITE_PRELOAD__', '[]')
        } else if (file.type === 'chunk') {
          file.code = file.code.replaceAll('__VITE_PRELOAD__', '[]')
        }
      })
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), viteSingleFile(), replacePreloadPlaceholder()],
  base: './',
  // vite-plugin-singlefile inlint alles in eine Datei und laesst dabei den
  // Preload-Platzhalter unersetzt stehen - jeder dynamische import() wirft dann
  // zur Laufzeit "__VITE_PRELOAD__ is not defined". Betrifft auch die optionalen
  // Pfade in jsPDF (html2canvas, DOMPurify, canvg), die wir nicht aufrufen.
  define: {
    __VITE_PRELOAD__: '[]',
  },
  build: {
    target: 'ES2020',
    minify: 'terser',
  },
})
