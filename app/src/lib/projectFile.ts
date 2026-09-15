import type { ProjectState } from '../types'

export const CURRENT_SCHEMA_VERSION = '1.0.0'
export const LOCALSTORAGE_KEY = 'flexteams-closing-tool-v1'

/**
 * Export ProjectState as JSON file
 */
export function exportProjectStateAsJSON(state: ProjectState, filename?: string): void {
  const dataStr = JSON.stringify(state, null, 2)
  const blob = new Blob([dataStr], { type: 'application/json;charset=utf-8;' })
  const link = document.createElement('a')
  const url = URL.createObjectURL(blob)

  const exportFilename = filename || `flexteams-project-${new Date().toISOString().substring(0, 10)}.json`
  link.setAttribute('href', url)
  link.setAttribute('download', exportFilename)
  link.style.visibility = 'hidden'

  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}

/**
 * Import ProjectState from JSON file
 */
export async function importProjectStateFromJSON(file: File): Promise<{ state: ProjectState; errors: string[] }> {
  const errors: string[] = []

  try {
    const text = await file.text()
    const parsed = JSON.parse(text)

    // Validate schema
    if (!parsed.schemaVersion) {
      errors.push('Missing schemaVersion')
    }

    if (!parsed.rateCards || !Array.isArray(parsed.rateCards)) {
      errors.push('Missing or invalid rateCards array')
    }

    if (!parsed.roles || !Array.isArray(parsed.roles)) {
      errors.push('Missing or invalid roles array')
    }

    if (!parsed.employees || !Array.isArray(parsed.employees)) {
      errors.push('Missing or invalid employees array')
    }

    if (!parsed.bundles || !Array.isArray(parsed.bundles)) {
      errors.push('Missing or invalid bundles array')
    }

    if (!parsed.projects || !Array.isArray(parsed.projects)) {
      errors.push('Missing or invalid projects array')
    }

    if (errors.length > 0) {
      return { state: parsed as ProjectState, errors }
    }

    return { state: parsed as ProjectState, errors: [] }
  } catch (err) {
    errors.push(`Failed to parse JSON: ${err instanceof Error ? err.message : String(err)}`)
    return {
      state: {
        schemaVersion: CURRENT_SCHEMA_VERSION,
        appVersion: '0.1.0',
        currentSnapshotId: '',
        snapshots: [],
        rateCards: [],
        roles: [],
        employees: [],
        bundles: [],
        projects: [],
        timeEntries: [],
      },
      errors,
    }
  }
}

/**
 * Get default empty ProjectState
 */
export function createEmptyProjectState(): ProjectState {
  return {
    schemaVersion: CURRENT_SCHEMA_VERSION,
    appVersion: '0.1.0',
    currentSnapshotId: '',
    snapshots: [],
    rateCards: [],
    roles: [],
    employees: [],
    bundles: [],
    projects: [],
    timeEntries: [],
    purchaseOrders: [],
    budgetConsumption: [],
  }
}
