import type { Project, ProjectState, ProjectResourceAssignment } from '../types'
import { normalizeProjectName } from './roleResolution'

/**
 * Hebt Zuordnungen aus dem alten Modell an.
 *
 * Früher zeigte eine Zuordnung über `roleId` auf eine eigene Rollen-Entität, der
 * Standort kam vom Mitarbeiter. Jetzt trägt die Zuordnung Funktion, Level und
 * Standort selbst - so kann sie direkt auf eine Rate Card zeigen.
 *
 * Läuft beim Laden aus IndexedDB und aus der Datei, damit gespeicherte Stände
 * nicht stumm ihre Rollen verlieren.
 */
export function migrateAssignments(state: ProjectState): ProjectState {
  const assignments = state.projectAssignments
  if (!assignments || assignments.length === 0) return state

  let changed = false

  const migrated = assignments.map(assignment => {
    // Bereits im neuen Format
    if (assignment.funktion && assignment.standort) return assignment

    const legacy = assignment as ProjectResourceAssignment & {
      roleId?: string
      roleName?: string
    }

    const role = legacy.roleId ? state.roles.find(r => r.id === legacy.roleId) : undefined

    changed = true

    return {
      id: assignment.id,
      projectId: assignment.projectId,
      employeeId: assignment.employeeId,
      employeeName: assignment.employeeName,
      funktion: role?.funktion ?? 'Software Engineer',
      level: role?.level ?? assignment.level ?? 'Senior',
      // Der Standort steckte bisher nur am Mitarbeiter, den es nicht mehr gibt
      standort: 'Deutschland',
    } satisfies ProjectResourceAssignment
  })

  if (!changed) return state

  console.info(`${migrated.length} Projekt-Zuordnung(en) auf das Rate-Card-Modell umgestellt.`)
  return { ...state, projectAssignments: migrated }
}


/**
 * Zieht die Ausprägung aus Projektnamen und Zeiteinträgen.
 *
 * Vor der Umstellung entstand je Ausprägung ein eigenes Projekt - "Atlas - Productive"
 * und "Atlas - Non Productive" waren zwei Einträge mit getrennter PO und getrennten
 * Rollen. Hier werden sie zusammengeführt: der kürzere Name bleibt, die
 * ursprünglichen Bezeichnungen wandern in die Aliase, und Zuordnungen der
 * aufgelösten Projekte zeigen danach auf das verbleibende.
 */
export function migrateProjectNames(state: ProjectState): ProjectState {
  const needsWork =
    state.projects.some(p => normalizeProjectName(p.name) !== p.name) ||
    state.snapshots.some(s =>
      s.timeEntries.some(e => normalizeProjectName(e.projectName) !== e.projectName)
    )

  if (!needsWork) return state

  // Projekte je normalisiertem Namen zusammenfassen
  const survivors = new Map<string, Project>()
  /** alte Projekt-Id -> Id des verbleibenden Projekts */
  const redirect = new Map<string, string>()

  state.projects.forEach(project => {
    const name = normalizeProjectName(project.name)
    const key = name.toLowerCase()
    const existing = survivors.get(key)

    // Ursprungsbezeichnung als Alias sichern, damit kuenftige Importe treffen
    const aliases = new Set([...(project.aliases ?? [])])
    if (project.name !== name) aliases.add(project.name)

    if (!existing) {
      survivors.set(key, {
        ...project,
        name,
        aliases: aliases.size > 0 ? Array.from(aliases) : undefined,
      })
      redirect.set(project.id, project.id)
      return
    }

    // Zusammenfuehren: eine vorhandene PO nicht durch eine leere ersetzen
    existing.purchaseOrder = existing.purchaseOrder ?? project.purchaseOrder
    ;[...(existing.aliases ?? []), ...aliases].forEach(a => aliases.add(a))
    existing.aliases = aliases.size > 0 ? Array.from(aliases) : undefined
    redirect.set(project.id, existing.id)
  })

  const normalizeEntries = <T extends { projectName: string }>(entries: T[]): T[] =>
    entries.map(entry => {
      const name = normalizeProjectName(entry.projectName)
      return name === entry.projectName ? entry : { ...entry, projectName: name }
    })

  const projects = Array.from(survivors.values())
  const merged = state.projects.length - projects.length

  console.info(
    `Projektnamen normalisiert${merged > 0 ? `, ${merged} Projekt(e) zusammengeführt` : ''}.`
  )

  return {
    ...state,
    projects,
    timeEntries: normalizeEntries(state.timeEntries),
    snapshots: state.snapshots.map(snapshot => ({
      ...snapshot,
      timeEntries: normalizeEntries(snapshot.timeEntries),
    })),
    // Zuordnungen aufgeloester Projekte umhaengen und dabei Doppelte verwerfen
    projectAssignments: dedupeAssignments(
      (state.projectAssignments ?? []).map(pa => ({
        ...pa,
        projectId: redirect.get(pa.projectId) ?? pa.projectId,
      }))
    ),
  }
}

/** Pro Projekt und Person darf nur eine Zuordnung bleiben. */
function dedupeAssignments(assignments: ProjectResourceAssignment[]): ProjectResourceAssignment[] {
  const seen = new Set<string>()
  return assignments.filter(pa => {
    const key = `${pa.projectId}|${pa.employeeId}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}
