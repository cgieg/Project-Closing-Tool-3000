import type { BillingSnapshot, ProjectState, TimeEntry } from '../types'
import {
  findProjectByName,
  findRateCard,
  isEntryBillable,
  resolveEffectiveRole,
  unresolvedChargeableAssignments,
  type UnresolvedAssignment,
} from './roleResolution'
import { amountFromDays, daysFromHours, roundHours } from './rounding'

/** Eine nach Rolle verdichtete Abrechnungszeile. */
export interface BillingLine {
  funktion: string
  level: string
  standort: string
  roleLabel: string
  hours: number
  days: number
  tagessatz: number
  betrag: number
  hasRateCard: boolean
  fromProjectAssignment: boolean
}

/** Stunden, die geleistet, aber nicht fakturiert werden. */
export interface NonChargeableSummary {
  hours: number
  /** Aufgeschlüsselt nach Tätigkeit, absteigend nach Stunden. */
  byTaskType: { taskType: string; hours: number }[]
}

/** Abrechnung eines Projekts in einem Monat. */
export interface ProjectBilling {
  projectId?: string
  /** Bundle, dem der zugrundeliegende Snapshot zugeordnet ist. */
  bundleId?: string
  projectName: string
  purchaseOrder?: string
  month: string
  lines: BillingLine[]
  hours: number
  days: number
  betrag: number
  /** Durchschnittlicher Tagessatz über alle Rollen dieses Projekts. */
  blendedRate: number
  /** Erfasst, aber nicht berechnet - Projektmanagement, Schulungen, Overhead. */
  nonChargeable: NonChargeableSummary
  missingRateCards: string[]
  missingEmployees: string[]
}

/** Monat eines Zeiteintrags als YYYY-MM. Dates überleben JSON-Roundtrips als String. */
export function entryMonth(entry: Pick<TimeEntry, 'date'>): string {
  const date = entry.date instanceof Date ? entry.date : new Date(entry.date)
  if (Number.isNaN(date.getTime())) return ''
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  return `${year}-${month}`
}

/** Stunden eines Eintrags - der Zeiterfassungs-Import füllt je nach Pfad effort oder effortHours. */
function entryHours(entry: any): number {
  return entry.effort ?? entry.effortHours ?? 0
}

/**
 * Rechnet eine Menge Zeiteinträge zu Abrechnungszeilen zusammen.
 *
 * Mitarbeiter werden über den Namen aufgelöst (so kommen sie aus der Zeiterfassung), die Rolle
 * ausschließlich über die projektspezifische Zuordnung.
 */
export function aggregateEntries(
  entries: TimeEntry[],
  employees: ProjectState['employees'],
  state: Pick<ProjectState, 'projects' | 'rateCards' | 'projectAssignments'>
): { lines: BillingLine[]; missingRateCards: string[]; missingEmployees: string[] } {
  // Erst je Mitarbeiter summieren - die Excel-Vorgabe rundet auf Personenebene
  // (Gesamtstunden je Ressource), nicht je Zeiteintrag und nicht erst nach dem
  // Zusammenfassen mehrerer Personen zur selben Rolle - siehe lib/rounding.ts.
  const byResource = new Map<
    string,
    { hours: number; role: ReturnType<typeof resolveEffectiveRole>; date?: Date }
  >()
  const missingEmployees = new Set<string>()

  entries
    .filter(entry => isEntryBillable(entry, findProjectByName(entry.projectName, state.projects)))
    .forEach(entry => {
      const employee = employees.find(e => e.name === entry.resource)
      if (!employee) {
        missingEmployees.add(entry.resource)
        return
      }

      const role = resolveEffectiveRole(
        employee,
        entry.projectName,
        state.projects,
        state.projectAssignments || []
      )

      const current = byResource.get(entry.resource) || {
        hours: 0,
        role,
        date: entry.date ? new Date(entry.date) : undefined,
      }
      current.hours += entryHours(entry)
      byResource.set(entry.resource, current)
    })

  const grouped = new Map<
    string,
    { hours: number; days: number; role: ReturnType<typeof resolveEffectiveRole>; date?: Date }
  >()
  byResource.forEach(({ hours, role, date }) => {
    const key = `${role.funktion}|${role.level}|${role.standort}`
    const hoursRounded = roundHours(hours)
    const days = daysFromHours(hoursRounded)
    const current = grouped.get(key) ?? { hours: 0, days: 0, role, date }
    current.hours += hoursRounded
    current.days += days
    grouped.set(key, current)
  })

  const lines: BillingLine[] = []
  const missingRateCards: string[] = []

  grouped.forEach(({ hours, days, role, date }) => {
    const rateCard = findRateCard(role, state.rateCards, date)
    const hoursRounded = hours
    const betrag = rateCard ? amountFromDays(days, rateCard.tagessatz) : 0

    if (!rateCard) {
      missingRateCards.push(`${role.level} ${role.funktion} (${role.standort})`)
    }

    lines.push({
      funktion: role.funktion,
      level: role.level,
      standort: role.standort,
      // Standort im Label - sonst verschmelzen Nearshore und Deutschland zu
      // einer Zeile, obwohl die Rate Cards und damit der Umsatzanteil je
      // Standort verschieden sind.
      roleLabel: `${role.level} ${role.funktion} (${role.standort})`,
      hours: hoursRounded,
      days,
      tagessatz: rateCard?.tagessatz ?? 0,
      betrag,
      hasRateCard: Boolean(rateCard),
      fromProjectAssignment: role.fromProjectAssignment,
    })
  })

  lines.sort((a, b) => b.betrag - a.betrag)

  return { lines, missingRateCards, missingEmployees: Array.from(missingEmployees) }
}

/**
 * Fasst die nicht abgerechneten Zeiten zusammen.
 *
 * Sie gehören in den Leistungsnachweis, weil sie geleistete Arbeit belegen -
 * nur eben ohne Rechnungsbetrag.
 */
export function summarizeNonChargeable(
  entries: TimeEntry[],
  project?: Pick<import('../types').Project, 'fakturierbar'>,
): NonChargeableSummary {
  const byType = new Map<string, number>()
  let hours = 0

  entries
    .filter(entry => !isEntryBillable(entry, project))
    .forEach(entry => {
      const h = entryHours(entry)
      const type = entry.taskType?.trim() || 'Sonstiges'
      hours += h
      byType.set(type, (byType.get(type) ?? 0) + h)
    })

  return {
    hours: roundHours(hours),
    byTaskType: Array.from(byType.entries())
      .map(([taskType, h]) => ({ taskType, hours: roundHours(h) }))
      .sort((a, b) => b.hours - a.hours),
  }
}

/**
 * Alle Abrechnungen eines Monats, je Projekt eine.
 *
 * Quelle sind die Snapshots, nicht state.timeEntries - nur dort steckt die manuelle
 * Abrechenbar-Kennzeichnung, die der Nutzer in der Abrechnungsansicht setzt.
 */
export function billingByProject(state: ProjectState, month: string): ProjectBilling[] {
  return buildBillings(state, month, entry => entryMonth(entry) === month)
}

/**
 * Dieselbe Rechnung über eine Auswahl von Abrechnungen statt über einen Monat.
 *
 * Die Bundle-Sicht spannt mehrere Projekte und Monate auf. Sie hatte bisher eine
 * eigene Summenbildung - damit konnten Bundle-Übersicht und Dashboard für dieselben
 * Daten verschiedene Zahlen zeigen.
 */
export function billingForSnapshots(
  state: ProjectState,
  snapshotIds: Iterable<string>
): ProjectBilling[] {
  const selected = new Set(snapshotIds)
  return buildBillings(state, '', () => true, snapshot => selected.has(snapshot.id))
}

/**
 * Sammelt Einträge projektweise ein und rechnet sie durch.
 *
 * `entryFilter` grenzt einzelne Zeilen ein (Monat), `snapshotFilter` ganze
 * Abrechnungen (Auswahl). Beide Sichten teilen sich damit einen Rechenweg.
 */
function buildBillings(
  state: ProjectState,
  month: string,
  entryFilter: (entry: TimeEntry) => boolean,
  snapshotFilter: (snapshot: BillingSnapshot) => boolean = () => true
): ProjectBilling[] {
  const byProject = new Map<
    string,
    { entries: TimeEntry[]; employees: ProjectState['employees']; bundleId?: string }
  >()
  // Ein Eintrag kann in mehreren Abrechnungen liegen - nur einmal zählen
  const seen = new Set<string>()

  state.snapshots.forEach((snapshot: BillingSnapshot) => {
    if (!snapshotFilter(snapshot)) return

    snapshot.timeEntries.forEach(entry => {
      if (!entryFilter(entry)) return

      const identity = entry.timeId ?? entry.id
      if (identity) {
        if (seen.has(identity)) return
        seen.add(identity)
      }

      const bucket = byProject.get(entry.projectName) ?? {
        entries: [],
        employees: [],
        bundleId: snapshot.bundleId,
      }
      bucket.entries.push(entry)

      snapshot.employees.forEach(employee => {
        if (!bucket.employees.some(e => e.id === employee.id)) {
          bucket.employees.push(employee)
        }
      })

      byProject.set(entry.projectName, bucket)
    })
  })

  const result: ProjectBilling[] = []

  byProject.forEach(({ entries, employees, bundleId }, projectName) => {
    const { lines, missingRateCards, missingEmployees } = aggregateEntries(entries, employees, state)

    const hours = roundHours(lines.reduce((sum, line) => sum + line.hours, 0))
    const days = lines.reduce((sum, line) => sum + line.days, 0)
    const betrag = lines.reduce((sum, line) => sum + line.betrag, 0)
    const project = findProjectByName(projectName, state.projects)

    result.push({
      projectId: project?.id,
      bundleId,
      projectName,
      purchaseOrder: project?.purchaseOrder,
      month,
      lines,
      hours,
      days,
      betrag,
      blendedRate: days > 0 ? betrag / days : 0,
      nonChargeable: summarizeNonChargeable(entries, project),
      missingRateCards,
      missingEmployees,
    })
  })

  return result.sort((a, b) => b.betrag - a.betrag)
}

/** Kennzahlen über eine Menge von Projektabrechnungen. */
export interface BundleSummary {
  betrag: number
  hours: number
  days: number
  blendedRate: number
  nonChargeableHours: number
  /** Anteil fakturierbarer an erbrachten Stunden, in Prozent. */
  billableShare: number
  byRole: { roleLabel: string; hours: number; days: number; betrag: number }[]
  missingRateCards: string[]
}

export function bundleSummary(billings: ProjectBilling[]): BundleSummary {
  const betrag = billings.reduce((sum, b) => sum + b.betrag, 0)
  const hours = roundHours(billings.reduce((sum, b) => sum + b.hours, 0))
  const days = billings.reduce((sum, b) => sum + b.days, 0)
  const nonChargeableHours = roundHours(billings.reduce((sum, b) => sum + b.nonChargeable.hours, 0))

  const roles = new Map<string, { hours: number; days: number; betrag: number }>()
  billings.forEach(billing => {
    billing.lines.forEach(line => {
      const current = roles.get(line.roleLabel) ?? { hours: 0, days: 0, betrag: 0 }
      current.hours += line.hours
      current.days += line.days
      current.betrag += line.betrag
      roles.set(line.roleLabel, current)
    })
  })

  const delivered = hours + nonChargeableHours

  return {
    betrag,
    hours,
    days,
    blendedRate: days > 0 ? betrag / days : 0,
    nonChargeableHours,
    billableShare: delivered > 0 ? (hours / delivered) * 100 : 0,
    byRole: Array.from(roles.entries())
      .map(([roleLabel, v]) => ({
        roleLabel,
        hours: roundHours(v.hours),
        days: v.days,
        betrag: v.betrag,
      }))
      .sort((a, b) => b.betrag - a.betrag),
    missingRateCards: Array.from(new Set(billings.flatMap(b => b.missingRateCards))),
  }
}

/** Umsatz je Rolle über alle Projekte eines Monats. */
export function revenueByRole(billings: ProjectBilling[]): Map<string, number> {
  const byRole = new Map<string, number>()

  billings.forEach(billing => {
    billing.lines.forEach(line => {
      byRole.set(line.roleLabel, (byRole.get(line.roleLabel) ?? 0) + line.betrag)
    })
  })

  return byRole
}

/** Umsatz je Bundle, darin je Projekt und je Rolle - Grundlage des Monatsberichts. */
export interface BundleRevenue {
  bundleId: string
  name: string
  kunde?: string
  total: number
  byProject: { projectName: string; betrag: number }[]
  byRole: { roleLabel: string; betrag: number }[]
}

/**
 * Gruppiert die Abrechnungen eines Monats nach Bundle.
 *
 * Nullzeilen bleiben aussen vor - dieselbe Regel wie in der Dashboard-Rangliste,
 * eine Position ohne Umsatz ist Rauschen, kein Befund.
 */
export function revenueByBundle(state: ProjectState, billings: ProjectBilling[]): BundleRevenue[] {
  const withRevenue = billings.filter(b => b.betrag > 0)

  const groups = new Map<
    string,
    { bundleId: string; name: string; kunde?: string; total: number; billings: ProjectBilling[] }
  >()

  withRevenue.forEach(billing => {
    const bundle = state.bundles.find(b => b.id === billing.bundleId)
    const key = bundle?.id ?? 'ohne'

    const group = groups.get(key) ?? {
      bundleId: key,
      name: bundle?.name || 'Ohne Bundle',
      kunde: bundle?.kunde,
      total: 0,
      billings: [],
    }
    group.total += billing.betrag
    group.billings.push(billing)
    groups.set(key, group)
  })

  return Array.from(groups.values())
    .map(group => ({
      bundleId: group.bundleId,
      name: group.name,
      kunde: group.kunde,
      total: group.total,
      byProject: [...group.billings]
        .sort((a, b) => b.betrag - a.betrag)
        .map(b => ({ projectName: b.projectName, betrag: b.betrag })),
      byRole: Array.from(revenueByRole(group.billings).entries())
        .map(([roleLabel, betrag]) => ({ roleLabel, betrag }))
        .sort((a, b) => b.betrag - a.betrag),
    }))
    .sort((a, b) => b.total - a.total)
}

/** Alle Monate mit Zeiteinträgen, neueste zuerst. */
export function availableMonths(state: ProjectState): string[] {
  const months = new Set<string>()

  state.snapshots.forEach(snapshot => {
    snapshot.timeEntries.forEach(entry => {
      const month = entryMonth(entry)
      if (month) months.add(month)
    })
  })

  return Array.from(months).sort().reverse()
}

/** Blended Rate über alle Rollen und Projekte eines Monats. */
export function blendedRate(billings: ProjectBilling[]): number {
  const days = billings.reduce((sum, b) => sum + b.days, 0)
  const betrag = billings.reduce((sum, b) => sum + b.betrag, 0)
  return days > 0 ? betrag / days : 0
}


/** Nicht fakturierbare Zeit eines Monats, aus mehreren Blickwinkeln. */
export interface NonChargeableOverview {
  totalHours: number
  totalDays: number
  /** Anteil an allen erbrachten Stunden, in Prozent. */
  share: number
  /** Was gemacht wurde - PM, Schulung, Overhead. */
  byTaskType: { taskType: string; hours: number }[]
  /** Wo es anfiel. */
  byProject: { projectName: string; hours: number }[]
  /** Wer die Zeit gebucht hat, absteigend. */
  byEmployee: { resource: string; hours: number }[]
}

/**
 * Fasst die nicht fakturierbaren Zeiten eines Monats projektübergreifend zusammen.
 *
 * Bewusst nicht "unproduktiv" genannt: Projektmanagement und Overhead sind geleistete
 * Arbeit, sie gehen nur nicht auf die Rechnung.
 *
 * Drei Aufschlüsselungen, weil sie verschiedene Fragen beantworten: nach Tätigkeit
 * zeigt, wofür die Zeit draufging; nach Projekt, wo der Aufwand sitzt; nach Person,
 * ob er sich auf Einzelne konzentriert.
 */
export function nonChargeableOverview(state: ProjectState, month: string): NonChargeableOverview {
  const byTaskType = new Map<string, number>()
  const byProject = new Map<string, number>()
  const byEmployee = new Map<string, number>()

  let totalHours = 0
  let chargeableHours = 0
  const seen = new Set<string>()

  state.snapshots.forEach(snapshot => {
    snapshot.timeEntries.forEach(entry => {
      if (entryMonth(entry) !== month) return

      // Ein Eintrag kann in mehreren Snapshots liegen - nur einmal zählen
      const identity = entry.timeId ?? entry.id
      if (identity) {
        if (seen.has(identity)) return
        seen.add(identity)
      }

      const hours = entryHours(entry)
      const project = findProjectByName(entry.projectName, state.projects)

      if (isEntryBillable(entry, project)) {
        chargeableHours += hours
        return
      }

      totalHours += hours
      const taskType = entry.taskType?.trim() || 'Sonstiges'
      byTaskType.set(taskType, (byTaskType.get(taskType) ?? 0) + hours)
      byProject.set(entry.projectName, (byProject.get(entry.projectName) ?? 0) + hours)
      byEmployee.set(entry.resource, (byEmployee.get(entry.resource) ?? 0) + hours)
    })
  })

  const rank = <K extends string>(map: Map<string, number>, key: K) =>
    Array.from(map.entries())
      .map(
        ([name, hours]) =>
          ({ [key]: name, hours: roundHours(hours) }) as { [P in K]: string } & { hours: number }
      )
      .sort((a, b) => b.hours - a.hours)

  const delivered = totalHours + chargeableHours

  return {
    totalHours: roundHours(totalHours),
    totalDays: daysFromHours(totalHours),
    share: delivered > 0 ? (totalHours / delivered) * 100 : 0,
    byTaskType: rank(byTaskType, 'taskType'),
    byProject: rank(byProject, 'projectName'),
    byEmployee: rank(byEmployee, 'resource'),
  }
}

/**
 * Produktivität eines Monats: WBS-basiert (isProductive), unabhängig von
 * Handumschaltungen an der Abrechenbar-Kennzeichnung.
 *
 * Getrennt von der Fakturierungsquote (chargeable-basiert) ausgewiesen - sobald
 * jemand einzelne Zeilen von Hand umschaltet oder ein Projekt auf nicht
 * fakturierbar setzt, laufen beide Zahlen auseinander. Genau das soll sichtbar
 * sein, nicht ineinander verschwinden.
 */
export function productivityShare(state: ProjectState, month: string): { productiveHours: number; totalHours: number; share: number } {
  let productiveHours = 0
  let totalHours = 0
  const seen = new Set<string>()

  state.snapshots.forEach(snapshot => {
    snapshot.timeEntries.forEach(entry => {
      if (entryMonth(entry) !== month) return

      const identity = entry.timeId ?? entry.id
      if (identity) {
        if (seen.has(identity)) return
        seen.add(identity)
      }

      const hours = entryHours(entry)
      totalHours += hours
      if (entry.isProductive) productiveHours += hours
    })
  })

  return {
    productiveHours: roundHours(productiveHours),
    totalHours: roundHours(totalHours),
    share: totalHours > 0 ? (productiveHours / totalHours) * 100 : 0,
  }
}

/** Unaufgelöste Rollen über alle gespeicherten Abrechnungen, dedupliziert über die TimeId. */
export function unresolvedAcrossSnapshots(state: ProjectState): UnresolvedAssignment[] {
  const seen = new Set<string>()
  const entries: TimeEntry[] = []

  state.snapshots.forEach(snapshot => {
    snapshot.timeEntries.forEach(entry => {
      const identity = entry.timeId ?? entry.id
      if (identity) {
        if (seen.has(identity)) return
        seen.add(identity)
      }
      entries.push(entry)
    })
  })

  return unresolvedChargeableAssignments(
    entries,
    state.employees,
    state.projects,
    state.projectAssignments ?? [],
  )
}

/** Wo ein einzelner Zeiteintrag abgerechnet wurde - für den Rückwärts-Drilldown. */
export interface BilledIn {
  snapshotId: string
  projectName: string
  documentNumber?: string
  version: number
  frozenAt: Date
}

export interface EntryCoverage {
  entry: TimeEntry
  billedIn: BilledIn[]
  /** Fakturierbar, aber in der aktuellen Fassung (oder noch gar keiner) nicht enthalten. */
  currentlyOpen: boolean
}

/**
 * Für jeden gespeicherten Zeiteintrag: in welchen Fassungen wurde er abgerechnet,
 * und ist er nach dem heutigen Stand offen.
 *
 * "Offen" heißt: fakturierbar, aber nicht in der jeweils neuesten Fassung seiner
 * Abrechnung enthalten - entweder weil die Abrechnung noch nie abgeschlossen
 * wurde, oder weil eine Korrektur die Zeile herausgenommen hat.
 */
export function coverageOfTimeEntries(state: ProjectState): EntryCoverage[] {
  const byId = new Map<string, EntryCoverage>()
  const identityOf = (e: TimeEntry) => e.timeId ?? e.id ?? ''

  state.snapshots.forEach(snapshot => {
    const revisions = [...(snapshot.revisions ?? [])].sort((a, b) => b.version - a.version)
    const project = findProjectByName(snapshot.timeEntries[0]?.projectName ?? '', state.projects)

    snapshot.timeEntries.forEach(entry => {
      const id = identityOf(entry)
      if (!id || byId.has(id)) return
      byId.set(id, { entry, billedIn: [], currentlyOpen: false })
    })

    revisions.forEach(revision => {
      revision.timeEntries.forEach(entry => {
        if (!entry.chargeable) return
        const id = identityOf(entry)
        const current = byId.get(id)
        if (!current) return
        current.billedIn.push({
          snapshotId: snapshot.id,
          projectName: revision.context.projectName,
          documentNumber: revision.documentNumber,
          version: revision.version,
          frozenAt: revision.frozenAt,
        })
      })
    })

    const latest = revisions[0]
    const latestBilledIds = latest
      ? new Set(latest.timeEntries.filter(e => e.chargeable).map(identityOf))
      : new Set<string>()

    snapshot.timeEntries.forEach(entry => {
      const id = identityOf(entry)
      const current = byId.get(id)
      if (!current) return
      current.currentlyOpen = isEntryBillable(entry, project) && !latestBilledIds.has(id)
    })
  })

  return Array.from(byId.values())
}

/** Fakturierbare Zeiteinträge, die in keiner abgeschlossenen Fassung stecken. */
export function openTimeEntries(state: ProjectState): EntryCoverage[] {
  return coverageOfTimeEntries(state).filter(c => c.currentlyOpen)
}
