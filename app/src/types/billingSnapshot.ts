import type { TimeEntry, Employee, RateCard } from './index'
import type { SnapshotRevision } from './snapshotRevision'

export interface BillingSnapshot {
  id: string
  bundleId: string
  month: string
  version: number
  locked: boolean
  createdAt: Date
  lastModifiedAt: Date
  lastModifiedBy?: string
  changelog?: string

  /**
   * Belegnummer des Leistungsnachweises - einmal vergeben beim ersten Abschluss,
   * bleibt über alle Korrekturfassungen hinweg stabil. Der Revisionsstand steht
   * auf dem Beleg zusätzlich als Fassungsnummer.
   */
  documentNumber?: string

  /**
   * Abgeschlossene Fassungen, älteste zuerst. Werden nie verändert.
   * Entsteht beim Abschließen einer Abrechnung.
   */
  revisions?: SnapshotRevision[]

  /**
   * Begründung für die laufende Fassung. Wird beim Anlegen einer Korrektur
   * gesetzt und beim nächsten Abschließen in die Fassung übernommen.
   */
  correctionReason?: string

  timeEntries: TimeEntry[]
  employees: Employee[]
  rateCards: RateCard[]
}
