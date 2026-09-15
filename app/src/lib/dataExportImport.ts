import type { ProjectState } from '../types'
import { defaultStateFileName } from './fileNaming'

export interface ExportData {
  exportVersion: string
  exportDate: string
  appVersion: string
  data: ProjectState
}

export const exportData = (state: ProjectState, filename?: string): void => {
  const exportData: ExportData = {
    exportVersion: '1.0',
    exportDate: new Date().toISOString(),
    appVersion: state.appVersion,
    data: state,
  }

  const jsonString = JSON.stringify(exportData, null, 2)
  const blob = new Blob([jsonString], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename || defaultStateFileName()
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

export const importData = (file: File): Promise<ExportData> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string
        const importedData = JSON.parse(content) as ExportData

        // Validierung
        if (!importedData.data || !importedData.exportDate) {
          throw new Error('Ungültiges Export-Format')
        }

        resolve(importedData)
      } catch (error) {
        reject(new Error(`Fehler beim Import: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`))
      }
    }
    reader.onerror = () => {
      reject(new Error('Fehler beim Lesen der Datei'))
    }
    reader.readAsText(file)
  })
}

/** Haengt Elemente an, ohne bereits vorhandene IDs zu duplizieren. */
const mergeById = <T extends { id: string }>(current: T[] = [], incoming: T[] = []): T[] => {
  const known = new Set(current.map(item => item.id))
  return [...current, ...incoming.filter(item => !known.has(item.id))]
}

export const mergeImportedData = (
  currentState: ProjectState,
  importedData: ProjectState,
  options: {
    replaceRateCards?: boolean
    replaceEmployees?: boolean
    replaceRoles?: boolean
    mergeSnapshots?: boolean
  } = {}
): ProjectState => {
  return {
    ...currentState,
    rateCards: options.replaceRateCards
      ? importedData.rateCards ?? []
      : mergeById(currentState.rateCards, importedData.rateCards),
    employees: options.replaceEmployees
      ? importedData.employees ?? []
      : mergeById(currentState.employees, importedData.employees),
    roles: options.replaceRoles
      ? importedData.roles ?? []
      : mergeById(currentState.roles, importedData.roles),
    snapshots: options.mergeSnapshots
      ? mergeById(currentState.snapshots, importedData.snapshots)
      : currentState.snapshots,
    bundles: mergeById(currentState.bundles, importedData.bundles),
    // Projekte tragen PO-Nummer und Budget - ohne sie waeren die Stammdaten nach
    // einem Restore leer und Dashboard wie Rollen-Zuordnung haetten nichts zu zeigen.
    projects: mergeById(currentState.projects, importedData.projects),
    projectAssignments: mergeById(
      currentState.projectAssignments ?? [],
      importedData.projectAssignments ?? []
    ),
    timeEntries:
      importedData.timeEntries && importedData.timeEntries.length > 0
        ? importedData.timeEntries
        : currentState.timeEntries,
    // Der Pruefpfad gehoert zum Datenbestand, nicht zum Arbeitsplatz. Ohne ihn
    // waere nach einem Wiederherstellen nicht mehr nachvollziehbar, wer wann
    // importiert, geaendert, freigegeben und exportiert hat - und genau das ist
    // der Zweck des Werkzeugs. Zusammengefuehrt statt ersetzt: beide Staende
    // koennen Eintraege haben, die der andere nicht kennt.
    auditLog: mergeById(currentState.auditLog ?? [], importedData.auditLog ?? []),
    // Nur uebernehmen, wenn hier noch keine Abrechnung geoeffnet ist. Sonst
    // risse ein Import dem Bearbeiter die Ansicht weg, in der er gerade steht.
    currentSnapshotId: currentState.currentSnapshotId || importedData.currentSnapshotId || '',
  }
}
