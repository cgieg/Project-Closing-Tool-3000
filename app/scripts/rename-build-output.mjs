// Benennt die von vite-plugin-singlefile erzeugte dist/index.html nach der
// aktuellen Build-Version um, damit die ausgelieferte Datei nicht "index.html"
// heisst, sondern "Closing and Budget Tool <Version>.html" traegt. Laeuft nach
// `vite build` und liest dieselbe Version, die bump-build-version.mjs zuvor
// geschrieben hat.
import { readFileSync, renameSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const versionFile = join(root, 'src', 'buildVersion.json')
const version = JSON.parse(readFileSync(versionFile, 'utf-8'))
const label = `${version.major}.${version.minor}`

const distDir = join(root, 'dist')
const source = join(distDir, 'index.html')
const target = join(distDir, `Closing and Budget Tool ${label}.html`)

if (!existsSync(source)) {
  throw new Error(`Erwartete Build-Ausgabe fehlt: ${source}`)
}

renameSync(source, target)
console.log(`Ausgeliefert: dist/Closing and Budget Tool ${label}.html`)
