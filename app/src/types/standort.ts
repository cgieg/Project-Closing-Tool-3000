/**
 * Delivery Center, an denen abgerechnet wird.
 *
 * Einzige Quelle für die Liste - Typ, Auswahlfelder, Import-Prüfung und Vorlage
 * leiten sich hier ab. Vorher stand sie an fünf Stellen und lief auseinander.
 *
 * Ein weiteres Land ergänzt man ausschließlich hier; die Rate Cards dafür kommen
 * dann wie gewohnt über die Vorlage.
 */
export const STANDORTE = [
  'Deutschland',
  'Spanien/Portugal',
  'Rumänien',
  'Polen',
  'Italien',
] as const

export type Standort = (typeof STANDORTE)[number]

/**
 * CSS-tauglicher Schlüssel für die farbige Kennzeichnung.
 * Umlaute und Schrägstriche haben in Klassennamen nichts verloren.
 */
export function standortKey(standort: string): string {
  return standort
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/** Prüft eine Eingabe gegen die Liste, ohne Rücksicht auf Groß- und Kleinschreibung. */
export function parseStandort(value: string): Standort | undefined {
  const normalized = value.trim().toLowerCase()
  return STANDORTE.find(s => s.toLowerCase() === normalized)
}
