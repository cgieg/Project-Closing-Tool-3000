/**
 * Nicht-kryptografische Prüfsumme fürs Importprotokoll.
 *
 * Muss nur bei gleichem Inhalt gleich und bei unterschiedlichem Inhalt
 * verschieden sein - kein Sicherheitsanspruch, nur Nachvollziehbarkeit, ob
 * zwei Importe dieselbe Datei betrafen.
 */
export function hashString(input: string): string {
  let h1 = 0xdeadbeef ^ input.length
  let h2 = 0x41c6ce57 ^ input.length

  for (let i = 0; i < input.length; i++) {
    const ch = input.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }

  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)

  return (h1 >>> 0).toString(16).padStart(8, '0') + (h2 >>> 0).toString(16).padStart(8, '0')
}

export async function hashArrayBuffer(buffer: ArrayBuffer): Promise<string> {
  const bytes = new Uint8Array(buffer)
  // Fuer eine reine Pruefsumme genuegt es, in Bloecken zu samplen statt jedes
  // Byte einzeln durch charCodeAt zu schicken - bei mehreren MB Excel-Datei
  // waere das sonst spuerbar langsam.
  let str = ''
  const step = Math.max(1, Math.floor(bytes.length / 200000))
  for (let i = 0; i < bytes.length; i += step) {
    str += String.fromCharCode(bytes[i])
  }
  return hashString(`${bytes.length}:${str}`)
}
