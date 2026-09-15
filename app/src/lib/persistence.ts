import type { ProjectState } from '../types'
import { estimateStorage, idbGet, idbSet, isIndexedDBAvailable, STORE_STATE } from './db'
import { LOCALSTORAGE_KEY } from './projectFile'
import { migrateAssignments, migrateProjectNames } from './migrateAssignments'
import {
  migrateBaselineRevisions,
  migrateRecalculateDays,
  repairMissingDocumentNumbers,
  repairZeroRateRevisions,
} from './revisions'
import { reviveDates } from './reviveDates'

/**
 * Arbeitsstand der Anwendung.
 *
 * Liegt in IndexedDB statt in localStorage: dort endet die Kapazität bei rund 5 MB,
 * was bei etwa 800 Byte je Zeiteintrag schon nach zwei bis drei Monatsimporten
 * erreicht wäre. IndexedDB bekommt einen Anteil der freien Festplatte.
 */

const STATE_KEY = 'current'
const AUTOSAVE_DELAY_MS = 1500

let saveTimer: ReturnType<typeof setTimeout> | undefined
let quotaWarningShown = false

export async function loadState(): Promise<ProjectState | null> {
  if (!isIndexedDBAvailable()) return loadLegacyFromLocalStorage()

  try {
    const stored = await idbGet<ProjectState>(STORE_STATE, STATE_KEY)
    if (stored && Array.isArray(stored.snapshots)) {
      // structuredClone hat Date-Objekte erhalten - trotzdem absichern, falls der
      // Datensatz aus einer alten Version als reines JSON hineingeraten ist.
      return repairMissingDocumentNumbers(
        repairZeroRateRevisions(
          migrateBaselineRevisions(
            migrateRecalculateDays(migrateProjectNames(migrateAssignments(reviveDates(stored)))),
          ),
        ),
      )
    }

    // Erststart nach der Umstellung: Altbestand übernehmen
    const legacy = loadLegacyFromLocalStorage()
    if (legacy) {
      await idbSet(STORE_STATE, STATE_KEY, legacy)
      localStorage.removeItem(LOCALSTORAGE_KEY)
      console.info('Arbeitsstand von localStorage nach IndexedDB übernommen.')
      return legacy
    }

    return null
  } catch (err) {
    console.error('Laden aus IndexedDB fehlgeschlagen:', err)
    return loadLegacyFromLocalStorage()
  }
}

function loadLegacyFromLocalStorage(): ProjectState | null {
  try {
    const raw = localStorage.getItem(LOCALSTORAGE_KEY)
    if (!raw) return null

    const parsed = JSON.parse(raw)
    if (!parsed?.snapshots) return null

    return repairMissingDocumentNumbers(
      repairZeroRateRevisions(
        migrateBaselineRevisions(
          migrateRecalculateDays(
            migrateProjectNames(migrateAssignments(reviveDates(parsed) as ProjectState)),
          ),
        ),
      ),
    )
  } catch {
    return null
  }
}

export async function saveState(state: ProjectState): Promise<void> {
  if (!isIndexedDBAvailable()) return

  try {
    await idbSet(STORE_STATE, STATE_KEY, state)
    await warnIfStorageTight()
  } catch (err) {
    console.error('Speichern in IndexedDB fehlgeschlagen:', err)

    if (err instanceof DOMException && err.name === 'QuotaExceededError' && !quotaWarningShown) {
      quotaWarningShown = true
      window.alert(
        'Der Browser-Speicher ist erschöpft. Der aktuelle Stand wurde nicht gesichert.\n\n' +
          'Bitte über "Speichern" in eine Datei schreiben und alte Bundles löschen.',
      )
    }
  }
}

/** Entprelltes Sichern - wird bei jeder Zustandsänderung aufgerufen. */
export function autoSaveState(state: ProjectState): void {
  if (saveTimer) clearTimeout(saveTimer)
  saveTimer = setTimeout(() => {
    void saveState(state)
  }, AUTOSAVE_DELAY_MS)
}

/** Sofort sichern, ohne auf die Entprellung zu warten. */
export async function flushPendingSave(state: ProjectState): Promise<void> {
  if (saveTimer) {
    clearTimeout(saveTimer)
    saveTimer = undefined
  }
  await saveState(state)
}

export async function clearStoredState(): Promise<void> {
  try {
    await idbSet(STORE_STATE, STATE_KEY, undefined)
  } catch (err) {
    console.error('Zurücksetzen fehlgeschlagen:', err)
  }
}

/** Meldet sich einmalig, wenn weniger als zehn Prozent des Kontingents frei sind. */
async function warnIfStorageTight(): Promise<void> {
  if (quotaWarningShown) return

  const estimate = await estimateStorage()
  if (!estimate || estimate.quotaMB === 0) return

  if (estimate.usedMB / estimate.quotaMB > 0.9) {
    quotaWarningShown = true
    console.warn(
      `Browser-Speicher zu ${Math.round((estimate.usedMB / estimate.quotaMB) * 100)}% belegt ` +
        `(${estimate.usedMB.toFixed(1)} von ${estimate.quotaMB.toFixed(0)} MB).`,
    )
  }
}

export { estimateStorage }
