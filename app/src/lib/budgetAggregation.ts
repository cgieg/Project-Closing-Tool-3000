import type { BudgetVerbrauch, PoRollenBudget, ProjectState, PurchaseOrder, RateCard } from '../types'
import { appendAuditLog } from './auditLog'
import { billingMonthKey } from './revisions'
import { roundTo } from './rounding'

/**
 * Budget Tracking: Purchase Orders, Rollenbudgets und Verbrauch.
 *
 * Kernidee: die Rolle (Funktion+Level+Standort - dasselbe Tripel wie bei einer
 * Rate Card) im Projekt ist der stabile Anker, nicht die PO. Eine PO-Rolle muss
 * zu einer echten Rate Card passen; ohne Standort liessen sich sonst Deutschland
 * und ein Nearshore-Standort mit demselben Funktion+Level-Paar unbemerkt
 * vermischen, obwohl sie unterschiedlich kosten. Eine PO trägt selbst kein
 * Restbudget-Feld - sie liefert der Rolle nur einen Budget-Zuwachs
 * (rollenBudgets). Verbrauch wird ausschließlich gegen die Rolle gebucht.
 * Dadurch bleibt die Verbrauchskurve beim PO-Wechsel lückenlos, und ein Stichtag
 * (z.B. das Laufzeitende einer auslaufenden PO) braucht keinen eigenen
 * Kontostand - er ist ein reiner Zeitfilter auf die ohnehin datierten Budget-
 * und Verbrauchseinträge.
 */

/** Rolle als Funktion+Level+Standort-Tripel - exakt wie eine Rate Card. */
export interface BudgetRole {
  funktion: string
  level: RateCard['level']
  standort: RateCard['standort']
}

function roleKey(role: BudgetRole): string {
  return `${role.funktion}|${role.level}|${role.standort}`
}

/** Rolle für Anzeige und Prüfpfad - wie roleLabel in billingAggregation.ts. */
export function roleLabel(role: BudgetRole): string {
  return `${role.level} ${role.funktion} (${role.standort})`
}

/** POs eines Projekts, älteste zuerst - so liest man eine Kette von Anfang an. */
export function purchaseOrdersOfProject(state: ProjectState, projectId: string): PurchaseOrder[] {
  return (state.purchaseOrders ?? [])
    .filter(po => po.projectId === projectId)
    .sort((a, b) => new Date(a.laufzeitStart).getTime() - new Date(b.laufzeitStart).getTime())
}

/** Die aktuell gültige PO eines Projekts - die späteste mit Status 'aktiv'. */
export function activePurchaseOrder(state: ProjectState, projectId: string): PurchaseOrder | undefined {
  const aktive = purchaseOrdersOfProject(state, projectId).filter(po => po.status === 'aktiv')
  return aktive[aktive.length - 1]
}

/** Alle Rollen mit Budget oder Verbrauch in einem Projekt, über die gesamte PO-Kette. */
export function rolesOfProject(state: ProjectState, projectId: string): BudgetRole[] {
  const seen = new Map<string, BudgetRole>()

  purchaseOrdersOfProject(state, projectId).forEach(po => {
    po.rollenBudgets.forEach(rb => {
      const role = { funktion: rb.funktion, level: rb.level, standort: rb.standort }
      seen.set(roleKey(role), role)
    })
  })

  ;(state.budgetConsumption ?? [])
    .filter(entry => entry.projectId === projectId)
    .forEach(entry => {
      const role = { funktion: entry.funktion, level: entry.level, standort: entry.standort }
      seen.set(roleKey(role), role)
    })

  const levelOrder = ['Expert', 'Senior', 'Intermediate', 'Junior']
  return Array.from(seen.values()).sort(
    (a, b) =>
      a.funktion.localeCompare(b.funktion) ||
      levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level) ||
      a.standort.localeCompare(b.standort),
  )
}

/** Letzter Moment einer Periode (YYYY-MM) - für den Stichtag-Vergleich. */
function periodeEnde(periode: string): Date {
  const [year, month] = periode.split('-').map(Number)
  return new Date(year, month, 0, 23, 59, 59, 999)
}

/** Budget, das einer Rolle bis zu einem Stichtag bereits bewilligt wurde (alle POs, kein Stichtag = alle). */
export function budgetBisStichtag(
  state: ProjectState,
  projectId: string,
  role: BudgetRole,
  stichtag?: Date,
): { betrag: number; tage: number } {
  let betrag = 0
  let tage = 0

  purchaseOrdersOfProject(state, projectId).forEach(po => {
    if (stichtag && new Date(po.laufzeitStart).getTime() > stichtag.getTime()) return
    po.rollenBudgets
      .filter(rb => rb.funktion === role.funktion && rb.level === role.level && rb.standort === role.standort)
      .forEach(rb => {
        betrag = roundTo(betrag + rb.betrag, 2)
        tage = roundTo(tage + (rb.tage ?? 0), 3)
      })
  })

  return { betrag, tage }
}

/** Verbrauch einer Rolle bis zu einem Stichtag - Initialwert plus Leistungsnachweise bis dahin. */
export function verbrauchBisStichtag(
  state: ProjectState,
  projectId: string,
  role: BudgetRole,
  stichtag?: Date,
): { betrag: number; tage: number } {
  let betrag = 0
  let tage = 0

  ;(state.budgetConsumption ?? [])
    .filter(
      entry =>
        entry.projectId === projectId &&
        entry.funktion === role.funktion &&
        entry.level === role.level &&
        entry.standort === role.standort,
    )
    .forEach(entry => {
      if (entry.typ === 'leistungsnachweis' && stichtag && entry.periode) {
        if (periodeEnde(entry.periode).getTime() > stichtag.getTime()) return
      }
      betrag = roundTo(betrag + entry.betrag, 2)
      tage = roundTo(tage + (entry.tage ?? 0), 3)
    })

  return { betrag, tage }
}

export interface RoleBudgetStatus extends BudgetRole {
  budget: number
  budgetTage: number
  verbrauch: number
  verbrauchTage: number
  rest: number
  restTage: number
  prozent: number
}

export function roleBudgetStatus(
  state: ProjectState,
  projectId: string,
  role: BudgetRole,
  stichtag?: Date,
): RoleBudgetStatus {
  const budget = budgetBisStichtag(state, projectId, role, stichtag)
  const verbrauch = verbrauchBisStichtag(state, projectId, role, stichtag)

  return {
    ...role,
    budget: budget.betrag,
    budgetTage: budget.tage,
    verbrauch: verbrauch.betrag,
    verbrauchTage: verbrauch.tage,
    rest: roundTo(budget.betrag - verbrauch.betrag, 2),
    restTage: roundTo(budget.tage - verbrauch.tage, 3),
    prozent: budget.betrag > 0 ? roundTo((verbrauch.betrag / budget.betrag) * 100, 1) : 0,
  }
}

export interface ProjectBudgetOverview {
  roles: RoleBudgetStatus[]
  gesamtBudget: number
  gesamtVerbrauch: number
  gesamtRest: number
  prozent: number
}

/** Budgetübersicht eines Projekts - optional zu einem Stichtag statt zu heute (US-2.1, US-2.2). */
export function projectBudgetOverview(
  state: ProjectState,
  projectId: string,
  stichtag?: Date,
): ProjectBudgetOverview {
  const roles = rolesOfProject(state, projectId).map(role =>
    roleBudgetStatus(state, projectId, role, stichtag),
  )

  const gesamtBudget = roundTo(roles.reduce((sum, r) => sum + r.budget, 0), 2)
  const gesamtVerbrauch = roundTo(roles.reduce((sum, r) => sum + r.verbrauch, 0), 2)

  return {
    roles,
    gesamtBudget,
    gesamtVerbrauch,
    gesamtRest: roundTo(gesamtBudget - gesamtVerbrauch, 2),
    prozent: gesamtBudget > 0 ? roundTo((gesamtVerbrauch / gesamtBudget) * 100, 1) : 0,
  }
}

/** Verbrauch je Monat, für die Trendauswertung (US-2.2). Der Initialwert steht bewusst nicht darin - er hat keine Periode. */
export function consumptionTimeline(
  state: ProjectState,
  projectId: string,
): { periode: string; betrag: number }[] {
  const byPeriode = new Map<string, number>()

  ;(state.budgetConsumption ?? [])
    .filter(entry => entry.projectId === projectId && entry.typ === 'leistungsnachweis' && entry.periode)
    .forEach(entry => {
      const periode = entry.periode!
      byPeriode.set(periode, roundTo((byPeriode.get(periode) ?? 0) + entry.betrag, 2))
    })

  return Array.from(byPeriode.entries())
    .map(([periode, betrag]) => ({ periode, betrag }))
    .sort((a, b) => a.periode.localeCompare(b.periode))
}

export interface PoStichtagReport {
  po: PurchaseOrder
  stichtag: Date
  roles: RoleBudgetStatus[]
}

/**
 * Verbrauch/Rest je Rolle einer PO zu einem Stichtag - Standard ist ihr eigenes
 * Laufzeitende (US-1.4). Zeigt die kumulierten Projektwerte bis dahin, nicht
 * einen isolierten PO-Kontostand: solange diese PO im fraglichen Zeitraum die
 * gültige war, ist das exakt derselbe Wert - siehe Konzeptpapier Abschnitt 04.
 */
export function poStichtagReport(
  state: ProjectState,
  poId: string,
  stichtag?: Date,
): PoStichtagReport | undefined {
  const po = (state.purchaseOrders ?? []).find(p => p.id === poId)
  if (!po) return undefined

  const effectiveStichtag = stichtag ?? (po.laufzeitEnde ? new Date(po.laufzeitEnde) : new Date())
  const roles = po.rollenBudgets.map(rb =>
    roleBudgetStatus(
      state,
      po.projectId,
      { funktion: rb.funktion, level: rb.level, standort: rb.standort },
      effectiveStichtag,
    ),
  )

  return { po, stichtag: effectiveStichtag, roles }
}

// --- Mutationen ---------------------------------------------------------

function generateId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
}

export interface NewPurchaseOrderInput {
  poNummer: string
  projectId: string
  laufzeitStart: Date
  laufzeitEnde?: Date
  /** Gesetzt bei einer Verlängerung/Aufstockung - die Vorgänger-PO wird abgelöst. */
  vorherigePoId?: string
  rollenBudgets: PoRollenBudget[]
}

/**
 * Legt eine neue PO an. Ist vorherigePoId gesetzt, wird die Vorgänger-PO
 * automatisch abgelöst (US-1.2) - Restbudget und Verbrauch der Rollen ändern
 * sich dabei nicht, sie hängen nie an der PO selbst.
 */
export function createPurchaseOrder(state: ProjectState, input: NewPurchaseOrderInput, by?: string): ProjectState {
  const nummer = input.poNummer.trim()
  if (!nummer) return state
  if ((state.purchaseOrders ?? []).some(po => po.poNummer === nummer)) return state

  const po: PurchaseOrder = {
    id: generateId('po'),
    poNummer: nummer,
    projectId: input.projectId,
    laufzeitStart: input.laufzeitStart,
    laufzeitEnde: input.laufzeitEnde,
    status: 'aktiv',
    vorherigePoId: input.vorherigePoId,
    rollenBudgets: input.rollenBudgets,
    createdAt: new Date(),
    createdBy: by,
  }

  const vorherigePo = input.vorherigePoId
    ? (state.purchaseOrders ?? []).find(p => p.id === input.vorherigePoId)
    : undefined

  const purchaseOrders = (state.purchaseOrders ?? []).map(existing =>
    vorherigePo && existing.id === vorherigePo.id ? { ...existing, status: 'abgeloest' as const } : existing,
  )

  const project = state.projects.find(p => p.id === input.projectId)
  const gesamtbudget = roundTo(po.rollenBudgets.reduce((sum, rb) => sum + rb.betrag, 0), 2)

  return appendAuditLog(
    { ...state, purchaseOrders: [...purchaseOrders, po] },
    'change',
    vorherigePo
      ? `PO ${nummer} verlängert Vorgänger-PO ${vorherigePo.poNummer} (${project?.name ?? input.projectId})`
      : `PO ${nummer} angelegt (${project?.name ?? input.projectId})`,
    { detail: `Budget: ${gesamtbudget.toFixed(2)} €`, by },
  )
}

export interface UpdatePurchaseOrderInput {
  poNummer: string
  laufzeitStart: Date
  laufzeitEnde?: Date
  rollenBudgets: PoRollenBudget[]
}

/**
 * Bearbeitet eine bestehende PO nachträglich - z.B. um eine falsch angelegte
 * Rolle zu korrigieren. Anders als bei einer Verlängerung entsteht keine neue
 * PO, sondern die vorhandene wird direkt überschrieben; ihr Status (aktiv/
 * abgelöst) und ihre Kette (vorherigePoId) bleiben unangetastet. Verbrauch
 * hängt an der Rolle, nie an der PO, daher bleiben bereits erfasste
 * Verbrauchseinträge von dieser Korrektur unberührt.
 */
export function updatePurchaseOrder(
  state: ProjectState,
  poId: string,
  input: UpdatePurchaseOrderInput,
  by?: string,
): ProjectState {
  const existing = (state.purchaseOrders ?? []).find(po => po.id === poId)
  if (!existing) return state

  const nummer = input.poNummer.trim()
  if (!nummer) return state
  if ((state.purchaseOrders ?? []).some(po => po.id !== poId && po.poNummer === nummer)) return state

  const project = state.projects.find(p => p.id === existing.projectId)
  const altBudget = roundTo(existing.rollenBudgets.reduce((sum, rb) => sum + rb.betrag, 0), 2)
  const neuBudget = roundTo(input.rollenBudgets.reduce((sum, rb) => sum + rb.betrag, 0), 2)

  const purchaseOrders = (state.purchaseOrders ?? []).map(po =>
    po.id === poId
      ? {
          ...po,
          poNummer: nummer,
          laufzeitStart: input.laufzeitStart,
          laufzeitEnde: input.laufzeitEnde,
          rollenBudgets: input.rollenBudgets,
        }
      : po,
  )

  return appendAuditLog(
    { ...state, purchaseOrders },
    'change',
    `PO ${nummer} bearbeitet (${project?.name ?? existing.projectId})`,
    { detail: `Budget: ${altBudget.toFixed(2)} € → ${neuBudget.toFixed(2)} €`, by },
  )
}

export interface InitialConsumptionInput {
  projectId: string
  funktion: string
  level: RateCard['level']
  standort: RateCard['standort']
  betrag: number
  tage?: number
}

/**
 * Erfasst oder korrigiert den einmaligen historischen Verbrauch einer Rolle
 * (US-4.1). Es gibt höchstens einen Initialwert je Rolle - eine erneute
 * Erfassung ist eine Korrektur (US-4.2) und wird als Alt→Neu im Prüfpfad
 * festgehalten, statt eine zweite Zeile entstehen zu lassen.
 */
export function recordInitialConsumption(
  state: ProjectState,
  input: InitialConsumptionInput,
  by?: string,
): ProjectState {
  const existing = (state.budgetConsumption ?? []).find(
    entry =>
      entry.projectId === input.projectId &&
      entry.funktion === input.funktion &&
      entry.level === input.level &&
      entry.standort === input.standort &&
      entry.typ === 'initial',
  )

  const project = state.projects.find(p => p.id === input.projectId)
  const label = roleLabel(input)

  if (existing) {
    if (existing.betrag === input.betrag && (existing.tage ?? 0) === (input.tage ?? 0)) return state

    const budgetConsumption = (state.budgetConsumption ?? []).map(entry =>
      entry.id === existing.id
        ? { ...entry, betrag: input.betrag, tage: input.tage, erfasstAm: new Date(), erfasstVon: by }
        : entry,
    )

    return appendAuditLog(
      { ...state, budgetConsumption },
      'change',
      `Initialwert ${label} korrigiert (${project?.name ?? input.projectId})`,
      { detail: `Alt: ${existing.betrag.toFixed(2)} € → Neu: ${input.betrag.toFixed(2)} €`, by },
    )
  }

  const entry: BudgetVerbrauch = {
    id: generateId('bv'),
    projectId: input.projectId,
    funktion: input.funktion,
    level: input.level,
    standort: input.standort,
    typ: 'initial',
    betrag: input.betrag,
    tage: input.tage,
    erfasstAm: new Date(),
    erfasstVon: by,
  }

  return appendAuditLog(
    { ...state, budgetConsumption: [...(state.budgetConsumption ?? []), entry] },
    'import',
    `Initialwert ${label} erfasst (${project?.name ?? input.projectId})`,
    { detail: `${input.betrag.toFixed(2)} €`, by },
  )
}

export interface LeistungsnachweisConsumptionLine {
  funktion: string
  level: RateCard['level']
  standort: RateCard['standort']
  betrag: number
  tage?: number
}

/**
 * Schreibt den Verbrauch aus einem abgeschlossenen Leistungsnachweis fort
 * (US-4.3) - je Rolle ein Eintrag für den betroffenen Monat. Erneutes Ausführen
 * für denselben Monat ersetzt die vorhandenen Zeilen statt sie zu verdoppeln,
 * damit ein korrigierter Beleg erneut übernommen werden kann.
 */
export function recordLeistungsnachweisConsumption(
  state: ProjectState,
  projectId: string,
  periode: string,
  lines: LeistungsnachweisConsumptionLine[],
  source: { snapshotId?: string; documentNumber?: string } = {},
  by?: string,
): ProjectState {
  const withoutPeriode = (state.budgetConsumption ?? []).filter(
    entry => !(entry.projectId === projectId && entry.typ === 'leistungsnachweis' && entry.periode === periode),
  )

  const neue: BudgetVerbrauch[] = lines
    .filter(line => line.betrag > 0 || (line.tage ?? 0) > 0)
    .map(line => ({
      id: generateId('bv'),
      projectId,
      funktion: line.funktion,
      level: line.level,
      standort: line.standort,
      typ: 'leistungsnachweis' as const,
      periode,
      betrag: line.betrag,
      tage: line.tage,
      erfasstAm: new Date(),
      erfasstVon: by,
      quelleSnapshotId: source.snapshotId,
      quelleDocumentNumber: source.documentNumber,
    }))

  const project = state.projects.find(p => p.id === projectId)

  return appendAuditLog(
    { ...state, budgetConsumption: [...withoutPeriode, ...neue] },
    'change',
    `Verbrauch ${periode} aus Leistungsnachweis übernommen (${project?.name ?? projectId})`,
    { detail: `${neue.length} Rolle(n)`, by, snapshotId: source.snapshotId },
  )
}

/**
 * Fasst die Zeilen einer Fassung (SnapshotRevision.lines) nach Funktion+Level+
 * Standort zusammen - Grundlage für recordLeistungsnachweisConsumption, wenn
 * der Verbrauch aus einem Leistungsnachweis übernommen wird. Derselbe Schlüssel
 * wie bei der Rate Card, damit sich Budget und übernommener Verbrauch exakt
 * demselben Tarif zuordnen lassen.
 */
export function consumptionLinesFromRevision(
  lines: { funktion: string; level: string; standort: string; betrag: number; days: number }[],
): LeistungsnachweisConsumptionLine[] {
  const byRole = new Map<string, LeistungsnachweisConsumptionLine>()

  lines.forEach(line => {
    const key = `${line.funktion}|${line.level}|${line.standort}`
    const current = byRole.get(key) ?? {
      funktion: line.funktion,
      level: line.level as RateCard['level'],
      standort: line.standort as RateCard['standort'],
      betrag: 0,
      tage: 0,
    }
    current.betrag = roundTo(current.betrag + line.betrag, 2)
    current.tage = roundTo((current.tage ?? 0) + line.days, 3)
    byRole.set(key, current)
  })

  return Array.from(byRole.values())
}

export interface RevisionForMonth {
  periode: string
  snapshotId: string
  documentNumber?: string
  lines: { funktion: string; level: string; standort: string; betrag: number; days: number }[]
}

/**
 * Neueste Fassung je abgeschlossenem Snapshot eines Projekts, mit Monat -
 * Grundlage, um Verbrauch aus einem Leistungsnachweis zu übernehmen (US-4.3).
 */
export function latestRevisionsForProject(state: ProjectState, projectId: string): RevisionForMonth[] {
  const project = state.projects.find(p => p.id === projectId)
  if (!project) return []

  const names = new Set([project.name, ...(project.aliases ?? [])])

  return state.snapshots
    .map((snapshot): RevisionForMonth | undefined => {
      const revisions = [...(snapshot.revisions ?? [])].sort((a, b) => b.version - a.version)
      const latest = revisions[0]
      if (!latest || !names.has(latest.context.projectName)) return undefined
      return {
        periode: billingMonthKey(snapshot),
        snapshotId: snapshot.id,
        documentNumber: latest.documentNumber,
        lines: latest.lines.map(l => ({
          funktion: l.funktion,
          level: l.level,
          standort: l.standort,
          betrag: l.betrag,
          days: l.days,
        })),
      }
    })
    .filter((x): x is RevisionForMonth => Boolean(x))
    .sort((a, b) => a.periode.localeCompare(b.periode))
}
