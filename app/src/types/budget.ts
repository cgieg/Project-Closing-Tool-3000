import type { RateCard } from './rateCard'

export type PurchaseOrderStatus = 'aktiv' | 'abgeloest'

/**
 * Budget-Zuwachs einer Rolle innerhalb einer PO.
 *
 * Rolle ist bewusst das Funktion+Level+Standort-Tripel einer Rate Card, nicht
 * eine eigene Rollen-Id - genau wie bei ProjectResourceAssignment. Der Standort
 * gehört zwingend dazu: eine PO-Rolle muss zu einer echten Rate Card passen, und
 * die unterscheidet Deutschland von Nearshore-Standorten über genau dieses Feld.
 */
export interface PoRollenBudget {
  funktion: string
  level: RateCard['level']
  standort: RateCard['standort']
  betrag: number
  tage?: number
}

/**
 * Purchase Order eines Projekts.
 *
 * Die PO-Nummer ist zugleich die Vertragsnummer - bei einer Verlängerung entsteht
 * eine komplett neue Nummer, die alte PO wird abgelöst, bleibt aber einsehbar.
 * Eine PO trägt selbst kein Restbudget-Feld: Verbrauch wird ausschließlich gegen
 * die Rolle im Projekt gebucht (siehe lib/budgetAggregation.ts), nie gegen eine
 * einzelne PO - sonst risse die Verbrauchskurve bei jedem PO-Wechsel ab.
 */
export interface PurchaseOrder {
  id: string
  /** Zugleich die Vertragsnummer. */
  poNummer: string
  projectId: string
  laufzeitStart: Date
  laufzeitEnde?: Date
  status: PurchaseOrderStatus
  /** Die PO, die durch diese verlängert/aufgestockt wurde. */
  vorherigePoId?: string
  rollenBudgets: PoRollenBudget[]
  createdAt: Date
  createdBy?: string
}

export type BudgetVerbrauchTyp = 'initial' | 'leistungsnachweis'

/**
 * Verbrauchseintrag einer Rolle innerhalb eines Projekts.
 *
 * 'initial': einmalige historische Gesamtsumme zum Trackingstart, ohne Periode.
 * 'leistungsnachweis': monatliche Fortschreibung danach, mit Periode (YYYY-MM).
 *
 * Ein Stichtag braucht damit keinen eigenen Kontostand pro PO - er ist ein reiner
 * Zeitfilter auf diese ohnehin schon datierten Einträge.
 */
export interface BudgetVerbrauch {
  id: string
  projectId: string
  funktion: string
  level: RateCard['level']
  standort: RateCard['standort']
  typ: BudgetVerbrauchTyp
  /** Nur bei typ 'leistungsnachweis' gesetzt, Format YYYY-MM. */
  periode?: string
  betrag: number
  tage?: number
  erfasstAm: Date
  erfasstVon?: string
  /** Bei typ 'leistungsnachweis': Herkunft des Belegs. */
  quelleSnapshotId?: string
  quelleDocumentNumber?: string
}

/**
 * Solange 'manuell': Verbrauch wird von Hand nachgetragen (Epic 4/5).
 * Auf 'automatisch' umgeschaltet, sobald die monatlichen Leistungsnachweise
 * zuverlässig genug sind, um den Verbrauch selbst fortzuschreiben.
 */
export type BudgetTrackingMode = 'manuell' | 'automatisch'
