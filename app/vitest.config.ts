import { defineConfig } from 'vitest/config'

/**
 * Eigene Konfiguration statt eines test-Blocks in vite.config.ts.
 *
 * Die Build-Konfiguration zieht vite-plugin-singlefile und den Preload-Ersatz
 * mit - beides gehoert zur Auslieferung als einzelne HTML-Datei und hat im
 * Testlauf nichts zu suchen. Vitest bevorzugt diese Datei automatisch.
 */
export default defineConfig({
  test: {
    // Die pruefbare Logik - Import, Klassifizierung, Aggregation, Rundung - ist
    // reine Rechnung ohne DOM. Ein spaeterer Komponententest braucht eine
    // eigene environment-Angabe (jsdom) und die passende Abhaengigkeit dazu.
    environment: 'node',
    include: ['src/**/*.test.ts'],
    // Die Fixture-Dateien liegen eine Ebene ueber app/ - Tests, die sie lesen,
    // duerfen aus dem Projektverzeichnis heraus zugreifen.
    root: '.',
  },
})
