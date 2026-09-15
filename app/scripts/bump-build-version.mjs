// Erhoeht die Build-Version vor jedem `npm run build` um eins (Nullpunkt-
// Versionierung: 0.1, 0.2, ... bis sie auf expliziten Wunsch hin manuell auf
// 1.0 gesetzt wird, siehe src/lib/buildVersion.ts). Laeuft vor `vite build`,
// damit der neue Stand sowohl in die Anwendung eingebacken als auch fuer den
// Dateinamen der Ausgabedatei (rename-build-output.mjs) verwendet wird.
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const versionFile = join(root, 'src', 'buildVersion.json')

const version = JSON.parse(readFileSync(versionFile, 'utf-8'))
version.minor += 1
writeFileSync(versionFile, `${JSON.stringify(version, null, 2)}\n`)

console.log(`Build-Version: ${version.major}.${version.minor}`)
