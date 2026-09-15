import type { Employee } from './employee'
import type { RateCard } from './rateCard'
import type { TimeEntry } from './timeEntry'

/** Eine Abrechnungszeile, wie sie auf dem Beleg stand. */
export interface RevisionLine {
  funktion: string
  level: string
  standort: string
  hours: number
  days: number
  tagessatz: number
  betrag: number
  hasRateCard: boolean
}

/** Stammdaten, die auf dem Beleg standen. */
export interface RevisionContext {
  projectName: string
  purchaseOrder?: string
  kunde?: string
  vertragsnummer?: string
}

/**
 * Eine abgeschlossene Fassung einer Abrechnung - unveränderlich.
 *
 * Eingefroren wird alles, wovon der Beleg abhängt, nicht nur die Zeiteinträge:
 * Rate Cards, Rollen, PO, Kunde und Vertragsnummer. Sonst druckt eine alte Fassung
 * später mit heutigen Sätzen, und genau das wäre in der Rechnungsprüfung wertlos.
 *
 * Auch das Rechenergebnis wird mitgeführt. Ändert sich die Rechenlogik - etwa die
 * Rundung -, bliebe eine Neuberechnung aus den Rohdaten sonst nicht bei dem Betrag,
 * der tatsächlich in Rechnung gestellt wurde.
 */
export interface SnapshotRevision {
  version: number
  frozenAt: Date
  /** Warum es diese Fassung gibt. Bei der ersten "Erstabrechnung". */
  reason: string
  /** Belegnummer des Leistungsnachweises - über alle Fassungen hinweg stabil. */
  documentNumber: string
  /**
   * Das bei der Freigabe erzeugte PDF, unverändert als Base64 abgelegt.
   *
   * Ein erneuter Druck aus den Rohdaten wäre zwar deterministisch (siehe
   * stableFileId in leistungsnachweisPdf.ts), aber für die Revision zählt der
   * tatsächlich ausgegebene Beleg, nicht eine rekonstruierte Kopie.
   */
  pdfBase64?: string
  pdfFileName?: string

  // Ergebnis zum Zeitpunkt des Einfrierens
  lines: RevisionLine[]
  /**
   * Geleistete, aber nicht berechnete Zeiten - nach derselben Rolle gruppiert
   * wie die Abrechnung. Optional, weil aeltere Fassungen sie noch nicht führen.
   */
  nonChargeableLines?: RevisionLine[]
  totalBetrag: number
  totalHours: number
  totalDays: number

  // Datenkopie für den Einzelnachweis
  timeEntries: TimeEntry[]
  employees: Employee[]
  rateCards: RateCard[]
  /** Rolle je Mitarbeiter als Paare - eine Map überlebt den JSON-Export nicht. */
  roleByResource: [string, string][]
  context: RevisionContext
}
