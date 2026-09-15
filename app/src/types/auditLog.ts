/**
 * Prüfpfad: die vier Protokolle aus der Anforderung "Revisionssichere
 * Rechnungsstellung" - Import, Änderung, Freigabe, Export.
 *
 * Bewusst ein einziges flaches Array statt vier getrennter Listen: die
 * Reihenfolge über Kategorien hinweg ist selbst Teil der Nachvollziehbarkeit
 * (wer hat wann worauf reagiert), und eine Kategorie ist nur ein Filter darauf.
 */
export type AuditLogCategory = 'import' | 'change' | 'freigabe' | 'export'

export interface AuditLogEntry {
  id: string
  category: AuditLogCategory
  /** Zeitpunkt des Ereignisses. */
  at: Date
  /** Bearbeitername aus lib/currentUser.ts - je Arbeitsplatz einmal gesetzt. */
  by: string
  message: string
  /** Freitext, z.B. Dateiname, Prüfsumme, Fassungsnummer. */
  detail?: string
  bundleId?: string
  snapshotId?: string
}
