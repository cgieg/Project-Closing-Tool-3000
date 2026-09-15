import type { RateCard } from './rateCard'

/**
 * Rolle eines Mitarbeiters in einem konkreten Projekt.
 *
 * Verweist bewusst auf die Rate-Card-Kombination (Funktion + Level + Standort)
 * statt auf eine eigene Rollen-Bezeichnung: so kann keine Rolle entstehen, für die
 * es keinen Tagessatz gibt.
 *
 * Gespeichert wird das Tripel und nicht die Rate-Card-Id, weil der Rate-Card-Import
 * bei jedem Lauf neue IDs vergibt. Der gültige Satz wird erst zum Buchungsdatum
 * aufgelöst - damit greifen Tarifwechsel im Zeitverlauf automatisch richtig.
 */
export interface ProjectResourceAssignment {
  id: string
  projectId: string
  employeeId: string
  /** Nur zur Anzeige - maßgeblich ist employeeId. */
  employeeName: string

  funktion: string
  level: RateCard['level']
  /** Der Standort bestimmt den Satz und kann je Projekt abweichen (Nearshore). */
  standort: RateCard['standort']
}
