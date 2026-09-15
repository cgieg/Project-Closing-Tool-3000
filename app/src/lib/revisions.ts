import type {
  BillingSnapshot,
  ProjectState,
  RevisionLine,
  SnapshotRevision,
  TimeEntry,
} from '../types'
import {
  findProjectByName,
  findRateCard,
  isEntryBillable,
  resolveEffectiveRole,
  unresolvedChargeableAssignments,
  type UnresolvedAssignment,
} from './roleResolution'
import { amountFromDays, daysFromHours, roundHours, roundTo } from './rounding'
import { getCurrentUser } from './currentUser'

/**
 * Nachträgliche Korrektur abgeschlossener Abrechnungen.
 *
 * Beim Abschließen wird eine vollständige, unveränderliche Fassung eingefroren.
 * Eine Korrektur lässt sie liegen und beginnt einen neuen Arbeitsstand. Was sich
 * geändert hat, wird aus dem Vergleich zweier Fassungen berechnet statt
 * mitgeschrieben - ein Ereignisprotokoll müsste bei jeder Änderung korrekt gefüllt
 * werden, und ein vergessener Eintrag erzeugt still eine falsche Historie.
 */

/** Rechnet den aktuellen Stand einer Abrechnung durch. */
export function computeSnapshotBilling(
  state: ProjectState,
  snapshot: BillingSnapshot,
): {
  lines: RevisionLine[]
  totalBetrag: number
  roleByResource: Map<string, string>
  nonChargeableLines: RevisionLine[]
} {
  // Erst je Mitarbeiter (Resource) summieren: die Excel-Vorgabe rundet auf
  // Personenebene (Gesamtstunden je Ressource), nicht je Zeiteintrag oder erst
  // nach dem Zusammenfassen mehrerer Personen zur selben Rolle - sonst weicht
  // der Beleg um Rundungscent von der Vorlage ab.
  const byResource = new Map<
    string,
    { hours: number; role: ReturnType<typeof resolveEffectiveRole>; date?: Date }
  >()
  // Nicht berechnete Zeiten getrennt, aber nach derselben Ressource gruppiert
  const byResourceFree = new Map<
    string,
    { hours: number; role: ReturnType<typeof resolveEffectiveRole> }
  >()
  const roleByResource = new Map<string, string>()

  const snapshotProject = findProjectByName(snapshot.timeEntries[0]?.projectName ?? '', state.projects)

  snapshot.timeEntries.forEach(entry => {
    const employee = snapshot.employees.find(e => e.name === entry.resource)
    if (!employee) return

    const role = resolveEffectiveRole(
      employee,
      entry.projectName,
      state.projects,
      state.projectAssignments ?? [],
    )

    // Auch fuer nicht berechnete Zeilen merken: der Leistungsnachweis weist sie
    // nach Rolle aus, und wer nur Overhead gebucht hat, fehlte sonst.
    roleByResource.set(entry.resource, `${role.level} ${role.funktion}`)

    if (isEntryBillable(entry, snapshotProject)) {
      const key = entry.resource
      const hours = entry.effort ?? entry.effortHours ?? 0
      const current = byResource.get(key) ?? {
        hours: 0,
        role,
        date: entry.date ? new Date(entry.date) : undefined,
      }
      current.hours += hours
      byResource.set(key, current)
    } else {
      const key = entry.resource
      const current = byResourceFree.get(key) ?? { hours: 0, role }
      current.hours += entry.effort ?? entry.effortHours ?? 0
      byResourceFree.set(key, current)
    }
  })

  // Je Mitarbeiter runden und Tage bilden, dann erst nach Rolle
  // zusammenfassen - siehe lib/rounding.ts.
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

  const lines: RevisionLine[] = []
  let totalBetrag = 0

  grouped.forEach(({ hours, days, role, date }) => {
    // Bewusst die aktuellen Rate Cards, nicht snapshot.rateCards: die Kopie im
    // Snapshot entsteht beim Zeitenimport und ist leer, wenn die Tagessaetze erst
    // danach gepflegt wurden. Die Oberflaeche rechnet ebenfalls mit state.rateCards -
    // waeren es zwei Quellen, zeigte der Beleg 0,00 EUR und die Ansicht den Betrag.
    // Der eingefrorene Beleg bleibt trotzdem fest: freezeRevision kopiert die Zeilen.
    const card = findRateCard(role, state.rateCards, date)
    const betrag = card ? amountFromDays(days, card.tagessatz) : 0
    totalBetrag = roundTo(totalBetrag + betrag, 2)

    lines.push({
      funktion: role.funktion,
      level: role.level,
      standort: role.standort,
      hours,
      days,
      tagessatz: card?.tagessatz ?? 0,
      betrag,
      hasRateCard: Boolean(card),
    })
  })

  lines.sort((a, b) => b.betrag - a.betrag)

  // Ohne Betrag - diese Stunden gehen nicht auf die Rechnung. Auch hier je
  // Mitarbeiter runden, dann nach Rolle zusammenfassen.
  const groupedFree = new Map<
    string,
    { hours: number; days: number; role: ReturnType<typeof resolveEffectiveRole> }
  >()
  byResourceFree.forEach(({ hours, role }) => {
    const key = `${role.funktion}|${role.level}|${role.standort}`
    const hoursRounded = roundHours(hours)
    const days = daysFromHours(hoursRounded)
    const current = groupedFree.get(key) ?? { hours: 0, days: 0, role }
    current.hours += hoursRounded
    current.days += days
    groupedFree.set(key, current)
  })

  const nonChargeableLines: RevisionLine[] = Array.from(groupedFree.values())
    .map(({ hours, days, role }) => ({
      funktion: role.funktion,
      level: role.level,
      standort: role.standort,
      hours,
      days,
      tagessatz: 0,
      betrag: 0,
      hasRateCard: false,
    }))
    .sort((a, b) => b.hours - a.hours)

  return { lines, totalBetrag, roleByResource, nonChargeableLines }
}

const GERMAN_MONTHS = [
  'januar', 'februar', 'märz', 'april', 'mai', 'juni',
  'juli', 'august', 'september', 'oktober', 'november', 'dezember',
]

/**
 * Abrechnungsmonat eines Snapshots als YYYY-MM.
 *
 * Erste Wahl ist snapshot.month - dort steht der beim Import bewusst gewählte
 * Monat ("August 2026 - Atlas"), nicht das Datum einzelner Zeiteinträge. Das
 * ist die eigentliche Bedeutung von "Abrechnungsmonat": eine nachträglich als
 * August importierte Korrektur mit einer verirrten Juli-Buchung soll trotzdem
 * als August gelten. Nur wenn sich das Label nicht parsen lässt (ältere oder
 * abweichend benannte Snapshots), wird aus den Zeiteinträgen abgeleitet.
 */
export function billingMonthKey(snapshot: BillingSnapshot): string {
  const label = snapshot.month.split(' - ')[0]?.trim() ?? ''
  const match = label.match(/^([A-Za-zÄÖÜäöü]+)\s+(\d{4})$/)
  if (match) {
    const idx = GERMAN_MONTHS.indexOf(match[1].toLowerCase())
    if (idx >= 0) return `${match[2]}-${String(idx + 1).padStart(2, '0')}`
  }

  const firstDate = snapshot.timeEntries
    .map(e => new Date(e.date))
    .filter(d => !Number.isNaN(d.getTime()))
    .sort((a, b) => a.getTime() - b.getTime())[0] ?? new Date(snapshot.createdAt)
  return `${firstDate.getFullYear()}-${String(firstDate.getMonth() + 1).padStart(2, '0')}`
}

/**
 * Belegnummer für den Leistungsnachweis - einmal vergeben, über alle
 * Korrekturfassungen stabil.
 *
 * Format {Abrechnungsmonat}-{Projekt}-LN. Projekt statt Bundle, weil ein Beleg
 * genau ein Projekt umfasst. Projekt und Monat sind im normalen Ablauf schon
 * eindeutig (ein Import legt je Projekt und Monat genau einen Snapshot an) -
 * eine laufende Nummer entfällt deshalb. Kollidiert eine Nummer trotzdem mit
 * einer bereits vergebenen (etwa nach einem parallelen Zweitimport), wird ein
 * Unterscheidungszähler angehängt statt zwei Belege dieselbe Nummer tragen zu
 * lassen - Revisionssicherheit verlangt eindeutige Nummern.
 */
export function generateDocumentNumber(state: ProjectState, snapshot: BillingSnapshot): string {
  const projectName = snapshot.timeEntries[0]?.projectName ?? ''
  const project = findProjectByName(projectName, state.projects)
  const projectSlug =
    (project?.name ?? projectName).replace(/[^A-Za-z0-9]+/g, '').slice(0, 16).toUpperCase() || 'PROJEKT'

  const monthKey = billingMonthKey(snapshot)
  const base = `${monthKey}-${projectSlug}-LN`

  const takenByOthers = new Set(
    state.snapshots.filter(s => s.id !== snapshot.id).map(s => s.documentNumber).filter(Boolean),
  )
  if (!takenByOthers.has(base)) return base

  let n = 2
  while (takenByOthers.has(`${base}-${n}`)) n++
  return `${base}-${n}`
}

/**
 * Prüft, ob eine Abrechnung abgeschlossen werden darf.
 *
 * Blockiert, wo eine Rolle sich nicht auflösen lässt - siehe
 * roleResolution.unresolvedChargeableAssignments. Jeder Mitarbeiter mit
 * fakturierbaren Stunden braucht eine Projektzuordnung, es gibt keinen Fallback.
 */
export function canLockSnapshot(
  state: ProjectState,
  snapshot: BillingSnapshot,
): { ok: boolean; unresolved: UnresolvedAssignment[] } {
  const unresolved = unresolvedChargeableAssignments(
    snapshot.timeEntries,
    snapshot.employees,
    state.projects,
    state.projectAssignments ?? [],
  )
  return { ok: unresolved.length === 0, unresolved }
}

/**
 * Friert den aktuellen Stand als Fassung ein.
 *
 * Kopiert bewusst tief: die Fassung darf sich nicht mehr ändern, wenn später am
 * Arbeitsstand weitergearbeitet wird.
 */
export function freezeRevision(
  state: ProjectState,
  snapshot: BillingSnapshot,
  reason: string,
  documentNumber: string,
): SnapshotRevision {
  const { lines, totalBetrag, roleByResource, nonChargeableLines } = computeSnapshotBilling(
    state,
    snapshot,
  )

  const projectName = snapshot.timeEntries[0]?.projectName ?? ''
  const project = findProjectByName(projectName, state.projects)
  const bundle = state.bundles.find(b => b.id === snapshot.bundleId)

  const totalHours = roundHours(lines.reduce((sum, line) => sum + line.hours, 0))

  return {
    version: snapshot.version,
    frozenAt: new Date(),
    reason,
    documentNumber,
    lines: lines.map(line => ({ ...line })),
    nonChargeableLines: nonChargeableLines.map(line => ({ ...line })),
    totalBetrag,
    totalHours,
    totalDays: daysFromHours(totalHours),
    timeEntries: snapshot.timeEntries.map(entry => ({ ...entry })),
    employees: snapshot.employees.map(employee => ({ ...employee })),
    rateCards: state.rateCards.map(card => ({ ...card })),
    roleByResource: Array.from(roleByResource.entries()),
    context: {
      projectName: project?.name ?? projectName,
      purchaseOrder: project?.purchaseOrder,
      kunde: bundle?.kunde,
      vertragsnummer: bundle?.vertragsnummer,
    },
  }
}

/**
 * Eine Korrekturzeile: was sich bei einer Rolle betraglich geändert hat.
 *
 * Aufgebaut wie eine Gutschriftzeile - Menge mal Satz ergibt den Betrag, mit
 * Vorzeichen. Ändert sich der Tagessatz zwischen zwei Fassungen, entstehen zwei
 * Zeilen: eine negative zum alten Satz, eine positive zum neuen. Genau so würde
 * man es auch auf einer Gutschrift ausweisen.
 */
export interface RoleCorrection {
  funktion: string
  level: string
  standort: string
  roleLabel: string
  tagessatz: number
  hoursDelta: number
  daysDelta: number
  betragDelta: number
}

/** Eine Position, deren Stunden sich geändert haben. */
export interface ChangedHours {
  entry: TimeEntry
  from: number
  to: number
}

/** Was zwischen zwei Fassungen passiert ist. */
export interface RevisionDiff {
  betragDelta: number
  hoursDelta: number
  /** Die Korrektur je Rolle - das, was auf den Beleg gehört. */
  byRole: RoleCorrection[]
  /** Positionen, die nicht mehr fakturiert werden. */
  nowNonChargeable: TimeEntry[]
  /** Positionen, die neu fakturiert werden. */
  nowChargeable: TimeEntry[]
  changedHours: ChangedHours[]
  added: TimeEntry[]
  removed: TimeEntry[]
  /** true, wenn sich am Betrag nichts geändert hat. */
  unchanged: boolean
}

const identityOf = (entry: TimeEntry): string => entry.timeId ?? entry.id ?? ''
const hoursOf = (entry: TimeEntry): number => entry.effort ?? entry.effortHours ?? 0

/**
 * Vergleicht zwei Fassungen.
 *
 * Zuordnung über die TimeId. Einträge ohne Id lassen sich nicht sicher verfolgen -
 * sie erscheinen als entfernt und hinzugefügt statt als geändert.
 */
export function diffRevisions(older: SnapshotRevision, newer: SnapshotRevision): RevisionDiff {
  const before = new Map(older.timeEntries.map(e => [identityOf(e), e]))
  const after = new Map(newer.timeEntries.map(e => [identityOf(e), e]))

  const nowNonChargeable: TimeEntry[] = []
  const nowChargeable: TimeEntry[] = []
  const changedHours: ChangedHours[] = []
  const added: TimeEntry[] = []
  const removed: TimeEntry[] = []

  after.forEach((entry, id) => {
    const previous = before.get(id)
    if (!previous) {
      added.push(entry)
      return
    }

    if (previous.chargeable && !entry.chargeable) nowNonChargeable.push(entry)
    if (!previous.chargeable && entry.chargeable) nowChargeable.push(entry)

    const from = roundHours(hoursOf(previous))
    const to = roundHours(hoursOf(entry))
    if (from !== to) changedHours.push({ entry, from, to })
  })

  before.forEach((entry, id) => {
    if (!after.has(id)) removed.push(entry)
  })

  const betragDelta = roundTo(newer.totalBetrag - older.totalBetrag, 2)
  const hoursDelta = roundHours(newer.totalHours - older.totalHours)

  return {
    betragDelta,
    hoursDelta,
    byRole: correctionsByRole(older, newer),
    nowNonChargeable,
    nowChargeable,
    changedHours,
    added,
    removed,
    unchanged:
      betragDelta === 0 &&
      nowNonChargeable.length === 0 &&
      nowChargeable.length === 0 &&
      changedHours.length === 0 &&
      added.length === 0 &&
      removed.length === 0,
  }
}

/** Alle Fassungen einer Abrechnung, neueste zuerst. */
export function revisionsOf(snapshot: BillingSnapshot): SnapshotRevision[] {
  return [...(snapshot.revisions ?? [])].sort((a, b) => b.version - a.version)
}

/**
 * Schließt eine Abrechnung ab und friert die Fassung ein.
 * Die Begründung stammt aus der letzten Korrektur, sonst ist es die Erstabrechnung.
 */
export function lockSnapshot(state: ProjectState, snapshotId: string): ProjectState {
  const snapshot = state.snapshots.find(s => s.id === snapshotId)
  if (!snapshot || snapshot.locked) return state

  // Defensiv nochmal geprüft - die Oberfläche prüft canLockSnapshot bereits vorher
  // und zeigt die Blocker an, aber ein Aufruf ohne diese Prüfung darf trotzdem
  // nicht durchrutschen.
  if (!canLockSnapshot(state, snapshot).ok) return state

  const reason = snapshot.correctionReason?.trim() || 'Erstabrechnung'
  const documentNumber = snapshot.documentNumber ?? generateDocumentNumber(state, snapshot)
  const revision = freezeRevision(state, snapshot, reason, documentNumber)

  return {
    ...state,
    snapshots: state.snapshots.map(s =>
      s.id === snapshotId
        ? {
            ...s,
            locked: true,
            documentNumber,
            lastModifiedAt: new Date(),
            lastModifiedBy: getCurrentUser() || s.lastModifiedBy,
            revisions: [...(s.revisions ?? []), revision],
          }
        : s,
    ),
  }
}

/**
 * Öffnet eine abgeschlossene Abrechnung für eine Korrektur.
 *
 * Die bisherige Fassung bleibt unangetastet; es beginnt eine neue mit erhöhter
 * Nummer. Ohne Begründung passiert nichts - eine Korrektur ohne Anlass wäre in
 * der Nachvollziehbarkeit wertlos.
 */
export function startCorrection(
  state: ProjectState,
  snapshotId: string,
  reason: string,
): ProjectState {
  const trimmed = reason.trim()
  if (!trimmed) return state

  const snapshot = state.snapshots.find(s => s.id === snapshotId)
  if (!snapshot || !snapshot.locked) return state

  return {
    ...state,
    snapshots: state.snapshots.map(s =>
      s.id === snapshotId
        ? {
            ...s,
            locked: false,
            version: s.version + 1,
            correctionReason: trimmed,
            lastModifiedAt: new Date(),
          }
        : s,
    ),
  }
}

/**
 * Stellt die Änderung je Rolle als Korrekturzeilen dar.
 *
 * Der Schlüssel enthält den Tagessatz: ändert er sich, ist das keine Mengen-,
 * sondern eine Preiskorrektur und gehört als zwei getrennte Zeilen ausgewiesen.
 */
function correctionsByRole(older: SnapshotRevision, newer: SnapshotRevision): RoleCorrection[] {
  const keyOf = (l: RevisionLine) => `${l.funktion}|${l.level}|${l.standort}|${l.tagessatz}`

  const before = new Map(older.lines.map(l => [keyOf(l), l]))
  const after = new Map(newer.lines.map(l => [keyOf(l), l]))
  const keys = new Set([...before.keys(), ...after.keys()])

  const corrections: RoleCorrection[] = []

  keys.forEach(key => {
    const a = before.get(key)
    const b = after.get(key)
    const reference = b ?? a
    if (!reference) return

    const hoursDelta = roundHours((b?.hours ?? 0) - (a?.hours ?? 0))
    const daysDelta = roundTo((b?.days ?? 0) - (a?.days ?? 0), 3)
    const betragDelta = roundTo((b?.betrag ?? 0) - (a?.betrag ?? 0), 2)

    if (hoursDelta === 0 && betragDelta === 0) return

    corrections.push({
      funktion: reference.funktion,
      level: reference.level,
      standort: reference.standort,
      roleLabel: `${reference.level} ${reference.funktion}`,
      tagessatz: reference.tagessatz,
      hoursDelta,
      daysDelta,
      betragDelta,
    })
  })

  // Größte Korrektur zuerst
  return corrections.sort((x, y) => Math.abs(y.betragDelta) - Math.abs(x.betragDelta))
}

/**
 * Legt für bereits abgeschlossene Abrechnungen ohne Fassung eine Grundfassung an.
 *
 * Abrechnungen, die vor Einführung der Fassungsverwaltung abgeschlossen wurden,
 * haben keine eingefrorene Kopie. Ohne sie zeigt der Verlauf nichts, und eine
 * Korrektur haette keine Vorfassung zum Vergleich - die Korrekturtabelle bliebe
 * leer, obwohl sich etwas geaendert hat.
 *
 * Der gespeicherte Stand ist genau das, was in Rechnung gestellt wurde; ihn als
 * Fassung festzuhalten ist deshalb verlustfrei.
 */
export function migrateBaselineRevisions(state: ProjectState): ProjectState {
  const needsBaseline = state.snapshots.filter(
    snapshot => snapshot.locked && (snapshot.revisions ?? []).length === 0,
  )

  if (needsBaseline.length === 0) return state

  const ids = new Set(needsBaseline.map(s => s.id))

  const snapshots = state.snapshots.map(snapshot => {
    if (!ids.has(snapshot.id)) return snapshot

    const reason =
      snapshot.correctionReason?.trim() ||
      (snapshot.version === 1 ? 'Erstabrechnung' : `Fassung ${snapshot.version}`)

    // Aeltere Abrechnungen kennen noch keine Belegnummer - beim Nachtragen
    // einmalig vergeben, damit die Fassung nicht ohne dasteht.
    const documentNumber = snapshot.documentNumber ?? generateDocumentNumber(state, snapshot)

    const revision = freezeRevision(state, snapshot, reason, documentNumber)
    // Der Zeitpunkt der letzten Aenderung trifft es besser als "jetzt"
    revision.frozenAt = new Date(snapshot.lastModifiedAt ?? snapshot.createdAt)

    return { ...snapshot, documentNumber, revisions: [revision] }
  })

  console.info(
    `${needsBaseline.length} abgeschlossene Abrechnung(en) nachträglich als Fassung festgehalten.`,
  )

  return { ...state, snapshots }
}

/**
 * Repariert Fassungen, die ohne Tagessatz eingefroren wurden.
 *
 * Bis zur Korrektur der Tagessatz-Quelle rechnete der Beleg mit der Kopie im
 * Snapshot. Die entsteht beim Zeitenimport - wurden die Rate Cards erst danach
 * gepflegt, wurde eine Fassung mit 0,00 EUR eingefroren. So ein Beleg war nie
 * eine gueltige Rechnung, und eine Korrektur dagegen weist die volle Summe als
 * Aenderung aus statt der tatsaechlichen Differenz.
 *
 * Bewusst eng: nur Fassungen, in denen KEINE einzige Zeile einen Tagessatz hat
 * und deren Summe 0,00 ist. Eine Fassung mit einem echten Betrag bleibt
 * unangetastet - eingefroren ist eingefroren.
 */
export function repairZeroRateRevisions(state: ProjectState): ProjectState {
  let repaired = 0

  const snapshots = state.snapshots.map(snapshot => {
    const revisions = snapshot.revisions ?? []
    if (revisions.length === 0) return snapshot

    const fixed = revisions.map(revision => {
      const broken =
        revision.lines.length > 0 &&
        revision.totalBetrag === 0 &&
        revision.lines.every(line => !line.hasRateCard)
      if (!broken) return revision

      // Aus der Kopie in der Fassung rechnen, nicht aus dem heutigen Arbeitsstand
      const { lines, totalBetrag, nonChargeableLines } = computeSnapshotBilling(state, {
        ...snapshot,
        timeEntries: revision.timeEntries,
        employees: revision.employees,
      })
      if (totalBetrag === 0) return revision

      repaired++
      const totalHours = roundHours(lines.reduce((sum, line) => sum + line.hours, 0))

      return {
        ...revision,
        lines,
        nonChargeableLines,
        totalBetrag,
        totalHours,
        totalDays: daysFromHours(totalHours),
      }
    })

    return repaired > 0 ? { ...snapshot, revisions: fixed } : snapshot
  })

  if (repaired === 0) return state

  console.info(`${repaired} Fassung(en) ohne Tagessatz nachtraeglich korrekt bewertet.`)
  return { ...state, snapshots }
}

/**
 * Vergibt Belegnummern nachträglich für Fassungen, die vor Einführung der
 * Belegnummer eingefroren wurden.
 *
 * Die erste Fassung eines Snapshots bestimmt dessen Belegnummer, spätere
 * Fassungen desselben Snapshots übernehmen sie unverändert - eine Korrektur
 * bekommt keine neue Nummer.
 */
export function repairMissingDocumentNumbers(state: ProjectState): ProjectState {
  const affected = state.snapshots.filter(
    s => (s.revisions ?? []).some(r => !r.documentNumber) || (s.locked && !s.documentNumber),
  )
  if (affected.length === 0) return state

  const snapshots = state.snapshots.map(snapshot => {
    if (!affected.some(s => s.id === snapshot.id)) return snapshot

    const documentNumber = snapshot.documentNumber ?? generateDocumentNumber(state, snapshot)
    const revisions = (snapshot.revisions ?? []).map(r => ({
      ...r,
      documentNumber: r.documentNumber || documentNumber,
    }))

    return { ...snapshot, documentNumber, revisions }
  })

  console.info(`${affected.length} Beleg(e) nachträglich mit einer Belegnummer versehen.`)
  return { ...state, snapshots }
}

/**
 * Neuberechnung der Tage nach korrekter Formel.
 *
 * Frühere Versionen berechneten Tage pro Rolle als (Summe Stunden) / 8.
 * Korrekt ist: (gerundete Stunden je Zeile) / 8, dann summieren.
 * Diese Migration berechnet alle Tage neu.
 */
export function migrateRecalculateDays(state: ProjectState): ProjectState {
  const snapshots = state.snapshots.map(snapshot => {
    // Entwürfe neu berechnen
    const { lines, totalBetrag, nonChargeableLines } = computeSnapshotBilling(state, snapshot)

    // Revisions (eingefrorene Fassungen) auch neu berechnen
    const revisions = (snapshot.revisions ?? []).map(revision => {
      const lines = revision.lines.map(line => {
        const hoursRounded = roundHours(line.hours)
        const days = daysFromHours(hoursRounded)
        return { ...line, hours: hoursRounded, days }
      })
      const nonChargeableLines = revision.nonChargeableLines?.map(line => {
        const hoursRounded = roundHours(line.hours)
        return { ...line, hours: hoursRounded, days: daysFromHours(hoursRounded) }
      }) ?? []
      const totalHours = roundHours(lines.reduce((sum, l) => sum + l.hours, 0))
      const totalDays = lines.reduce((sum, l) => sum + l.days, 0)
      return { ...revision, lines, nonChargeableLines, totalHours, totalDays }
    })

    return { ...snapshot, lines, nonChargeableLines, revisions }
  })

  return { ...state, snapshots }
}
