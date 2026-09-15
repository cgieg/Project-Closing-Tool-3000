/**
 * JSON kennt keinen Date-Typ - nach dem Laden aus einer Datei sind alle
 * Datumsfelder Strings. Ohne Rückwandlung schlägt jeder Aufruf von
 * date.toISOString() fehl.
 *
 * Für IndexedDB wird das nicht gebraucht: structuredClone erhält Date-Objekte.
 */
const DATE_FIELDS = [
  'date',
  'createdAt',
  'lastModifiedAt',
  'importedAt',
  'gueltigVon',
  'gueltigBis',
  'frozenAt',
  'at',
  'laufzeitStart',
  'laufzeitEnde',
  'erfasstAm',
]

export function reviveDates<T>(value: T): T {
  if (Array.isArray(value)) {
    return value.map(item => reviveDates(item)) as unknown as T
  }

  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const result: Record<string, unknown> = { ...(value as Record<string, unknown>) }

    Object.keys(result).forEach(key => {
      const entry = result[key]

      if (DATE_FIELDS.includes(key) && typeof entry === 'string') {
        const parsed = new Date(entry)
        result[key] = Number.isNaN(parsed.getTime()) ? entry : parsed
        return
      }

      if (entry && typeof entry === 'object') {
        result[key] = reviveDates(entry)
      }
    })

    return result as T
  }

  return value
}
