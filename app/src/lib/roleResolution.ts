import type { Employee, Project, ProjectResourceAssignment, RateCard, TimeEntry } from '../types'

/**
 * Die effektive Abrechnungs-Rolle eines Mitarbeiters in einem konkreten Projekt.
 * Kombiniert Funktion + Level + Standort - das ist der Schlüssel für den Rate-Card-Lookup.
 */
export interface EffectiveRole {
  funktion: string
  level: string
  standort: string
  /** true, wenn die Rolle aus einer projektspezifischen Zuordnung stammt */
  fromProjectAssignment: boolean
}

/**
 * Schneidet die Ausprägung vom Projektnamen ab.
 *
 * Die Zeiterfassung liefert je Projekt zwei Varianten - "Atlas - Productive" und
 * "Atlas - Non Productive". Beide gehören zum selben Projekt; ob eine Zeile
 * produktiv ist, steht bereits in der WBS-Nummer und im Abrechenbar-Kennzeichen.
 * Ohne das Abschneiden entstünden aus einem Projekt zwei.
 */
export function normalizeProjectName(rawName: string): string {
  if (!rawName) return rawName
  return rawName
    .replace(/[\s(]*[-–]?\s*(non[\s-]*productive|unproductive|nicht[\s-]*produktiv|unproduktiv|productive)\s*\)?\s*$/i, '')
    .trim()
}

/**
 * Erkennt die produktive bzw. unproduktive Ausprägung am Task-Namen.
 *
 * Zweites Signal neben der WBS-Nummer: Die Zeiterfassung markiert unproduktive Zeiten eines
 * Projekts als "Atlas - Unproductive". Verlässt man sich allein auf WBS 2.x, würden
 * solche Zeilen als produktiv gelten und auf der Rechnung landen.
 *
 * Deckt bewusst mehr Schreibweisen ab als in der bisher gesehenen Datenlage
 * vorkommen: Klammer statt Bindestrich, deutsche Bezeichnung, ohne Trenner.
 * Die August-Fixture kennt keine einzige Unproductive-Zeile - das Muster ist
 * ungeprüft an echten Daten, aber solche Tasks kommen künftig.
 *
 * Unproductive zuerst geprüft: "Non Productive" endet selbst auf "productive"
 * und würde sonst faelschlich als produktiv erkannt.
 */
const UNPRODUCTIVE_SUFFIX =
  /[\s(]*[-–]?\s*(non[\s-]*productive|unproductive|nicht[\s-]*produktiv|unproduktiv)\)?\s*$/i
const PRODUCTIVE_SUFFIX = /[\s(]*[-–]?\s*productive\)?\s*$/i

export function isUnproductiveVariant(rawName: string): boolean {
  if (!rawName) return false
  return UNPRODUCTIVE_SUFFIX.test(rawName.trim())
}

export type TaskProductivity = 'productive' | 'unproductive' | 'unclear'

/**
 * Klassifiziert die Ausprägung eines Task-Namens.
 *
 * 'unclear', wenn weder ein produktives noch ein unproduktives Muster greift -
 * dann soll der Import das melden statt eine Zeile stillschweigend abzurechnen.
 */
export function classifyTaskProductivity(rawName: string): TaskProductivity {
  if (!rawName) return 'unclear'
  const trimmed = rawName.trim()
  if (UNPRODUCTIVE_SUFFIX.test(trimmed)) return 'unproductive'
  if (PRODUCTIVE_SUFFIX.test(trimmed)) return 'productive'
  return 'unclear'
}

/**
 * Findet das Projekt zu einem Projektnamen aus den Zeiteinträgen.
 *
 * Vergleich ohne Beachtung von Groß-/Kleinschreibung und Rand-Leerzeichen, weil die
 * Zeiterfassungs-Exporte hier nicht konsistent sind. Zusätzlich greifen die Alias-Namen, mit
 * denen ein von Hand angelegtes Projekt an die Fremdbezeichnung gebunden wird.
 */
export function findProjectByName(projectName: string, projects: Project[]): Project | undefined {
  if (!projectName) return undefined
  const normalized = projectName.trim().toLowerCase()

  const byName = projects.find(p => p.name.trim().toLowerCase() === normalized)
  if (byName) return byName

  return projects.find(p =>
    p.aliases?.some(alias => alias.trim().toLowerCase() === normalized)
  )
}

/**
 * Ermittelt die Rolle, mit der ein Mitarbeiter in einem Projekt abgerechnet wird.
 *
 * Es gibt keine Stammdaten-Rolle mehr, an der sich das ohne Zuordnung festmachen
 * ließe - die projektspezifische Zuordnung ist die einzige Quelle für Funktion,
 * Level und Standort. Fehlt sie, ist die Rolle offen (leere Felder), und
 * isRoleUnresolved greift.
 */
export function resolveEffectiveRole(
  employee: Employee,
  projectName: string,
  projects: Project[],
  projectAssignments: ProjectResourceAssignment[] = []
): EffectiveRole {
  const project = findProjectByName(projectName, projects)
  if (project) {
    const assignment = projectAssignments.find(
      pa => pa.projectId === project.id && pa.employeeId === employee.id
    )

    if (assignment) {
      return {
        funktion: assignment.funktion,
        level: assignment.level,
        standort: assignment.standort,
        fromProjectAssignment: true,
      }
    }
  }

  return { funktion: '', level: '', standort: '', fromProjectAssignment: false }
}

/**
 * Sucht die passende Rate Card zu einer effektiven Rolle.
 *
 * Funktion, Level und Standort müssen alle drei stimmen. Der Standort ist ein
 * Preistreiber - ihn bei fehlender Karte zu ignorieren, würde eine Nearshore-Rolle
 * stillschweigend zum deutschen Satz abrechnen. Fehlt die Karte, ist das ein
 * Befund, den die Oberfläche meldet, kein Fall für einen Notnagel.
 *
 * Nur die Gültigkeitsprüfung kennt einen Rückfall: gibt es zum Buchungsdatum keine
 * gültige Karte, wird eine gleiche Kombination ohne Datumsprüfung genommen. Ein
 * abgelaufener Satz ist aussagekräftiger als 0 EUR - die Oberfläche weist darauf hin.
 */
export function findRateCard(
  role: { funktion: string; level: string; standort: string },
  rateCards: RateCard[],
  date?: Date
): RateCard | undefined {
  const matches = (rc: RateCard): boolean =>
    rc.funktion === role.funktion && rc.level === role.level && rc.standort === role.standort

  const isValidAt = (rc: RateCard): boolean => {
    if (!date) return true
    const von = rc.gueltigVon ? new Date(rc.gueltigVon) : undefined
    const bis = rc.gueltigBis ? new Date(rc.gueltigBis) : undefined
    if (von && date < von) return false
    if (bis && date > bis) return false
    return true
  }

  return rateCards.find(rc => matches(rc) && isValidAt(rc)) ?? rateCards.find(matches)
}

/**
 * Label für die Anzeige einer effektiven Rolle.
 */
export function formatRoleLabel(role: EffectiveRole | { funktion: string; level: string }): string {
  return `${role.level} ${role.funktion}`
}

/**
 * Ist ein Zeiteintrag tatsächlich fakturierbar?
 *
 * Zwei unabhängige Schalter: die Kennzeichnung am Eintrag selbst (aus WBS
 * abgeleitet, von Hand umschaltbar) und der Fakturierbar-Schalter am Projekt.
 * Der Projekt-Schalter sticht - ein komplett nicht fakturierbares Projekt darf
 * nicht dadurch abrechnen, dass einzelne Zeilen als abrechenbar markiert sind.
 */
export function isEntryBillable(
  entry: Pick<TimeEntry, 'chargeable'>,
  project: Pick<Project, 'fakturierbar'> | undefined,
): boolean {
  return Boolean(entry.chargeable) && project?.fakturierbar !== false
}

/** Eine Rolle ohne Funktion lässt sich keiner Rate Card zuordnen - "Rolle offen". */
export function isRoleUnresolved(role: Pick<EffectiveRole, 'funktion'>): boolean {
  return !role.funktion || !role.funktion.trim()
}

/** Ein Mitarbeiter mit ungeklärter Rolle in einem Projekt, samt Stundenumfang. */
export interface UnresolvedAssignment {
  employeeId: string
  employeeName: string
  projectId?: string
  projectName: string
  hours: number
}

/**
 * Mitarbeiter mit fakturierbaren Stunden, deren Rolle sich nicht auflösen lässt.
 *
 * "Rolle offen" heißt: es gibt keine projektspezifische Zuordnung. Das ist die
 * einzige Quelle für eine Rolle - blockiert wird also jeder, der noch keine hat.
 */
export function unresolvedChargeableAssignments(
  entries: TimeEntry[],
  employees: Employee[],
  projects: Project[],
  projectAssignments: ProjectResourceAssignment[] = [],
): UnresolvedAssignment[] {
  const byKey = new Map<string, UnresolvedAssignment>()

  entries
    .filter(entry => entry.chargeable)
    .forEach(entry => {
      const employee = employees.find(e => e.name === entry.resource)
      if (!employee) return

      const role = resolveEffectiveRole(employee, entry.projectName, projects, projectAssignments)
      if (!isRoleUnresolved(role)) return

      const project = findProjectByName(entry.projectName, projects)
      const key = `${employee.id}|${project?.id ?? entry.projectName}`
      const current = byKey.get(key) ?? {
        employeeId: employee.id,
        employeeName: employee.name,
        projectId: project?.id,
        projectName: project?.name ?? entry.projectName,
        hours: 0,
      }
      current.hours += entry.effort ?? entry.effortHours ?? 0
      byKey.set(key, current)
    })

  return Array.from(byKey.values()).sort((a, b) => b.hours - a.hours)
}
