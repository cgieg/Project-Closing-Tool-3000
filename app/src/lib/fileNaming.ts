/**
 * Kurzform aus Akronym (CT = Closing Tool), Datum (TTMMJJ) und
 * Uhrzeit (HHmm), damit mehrere Speicherstaende zeitlich sortierbar und
 * eindeutig unterscheidbar bleiben.
 */
export function defaultStateFileName(extension = '.json'): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const now = new Date()
  const date = `${pad(now.getDate())}${pad(now.getMonth() + 1)}${String(now.getFullYear()).slice(-2)}`
  const time = `${pad(now.getHours())}${pad(now.getMinutes())}`
  return `CT-${date}-${time}${extension}`
}
