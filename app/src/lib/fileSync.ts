import type { ProjectState } from '../types'
import { idbDelete, idbGet, idbSet, STORE_HANDLES } from './db'
import { migrateAssignments, migrateProjectNames } from './migrateAssignments'
import { migrateBaselineRevisions, repairMissingDocumentNumbers } from './revisions'
import { reviveDates } from './reviveDates'
import { getCurrentUser } from './currentUser'
import { defaultStateFileName } from './fileNaming'

/**
 * Speichern und Öffnen der Abrechnungsdatei.
 *
 * Bevorzugt wird die File System Access API: die App schreibt dann direkt in eine
 * Datei - etwa in einem SharePoint- oder OneDrive-Sync-Ordner, den der Sync-Client
 * hochlädt. Der Dateizugriff wird gemerkt, sodass "Speichern" nach einem Neuladen
 * ohne erneute Dateiauswahl funktioniert.
 *
 * Fehlt die API (Firefox, Safari, teils auch lokale file://-Aufrufe), fällt alles
 * auf klassischen Download und Datei-Upload zurück.
 */

const HANDLE_KEY = 'current-file'

/**
 * Die File System Access API ist in den TypeScript-Standardtypen noch nicht
 * enthalten. Nur das hier tatsaechlich Genutzte deklarieren, statt eine
 * zusaetzliche Typ-Abhaengigkeit aufzunehmen.
 */
interface PickerOptions {
  types?: { description: string; accept: Record<string, string[]> }[]
  suggestedName?: string
  multiple?: boolean
}

type PermissionState = 'granted' | 'denied' | 'prompt'

interface FileSystemHandlePermission {
  queryPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
  requestPermission?(options: { mode: 'read' | 'readwrite' }): Promise<PermissionState>
}

export interface FileHandle extends FileSystemHandlePermission {
  readonly name: string
  getFile(): Promise<File>
  createWritable(): Promise<{
    write(data: string): Promise<void>
    close(): Promise<void>
  }>
}

interface FilePickerWindow {
  showSaveFilePicker(options?: PickerOptions): Promise<FileHandle>
  showOpenFilePicker(options?: PickerOptions): Promise<FileHandle[]>
}

function pickerApi(): FilePickerWindow {
  return window as unknown as FilePickerWindow
}

export interface AppFile {
  formatVersion: string
  savedAt: string
  /** Bearbeitername des Arbeitsplatzes, der zuletzt gespeichert hat. */
  savedBy?: string
  appVersion: string
  data: ProjectState
}

export interface OpenResult {
  state: ProjectState
  fileName: string
  handle?: FileHandle
  /** Wer die Datei zuletzt gespeichert hat und wann - für die Warnung bei fremdem Stand. */
  savedBy?: string
  savedAt?: string
}

const pickerOptions: PickerOptions = {
  types: [
    {
      description: 'Closing Tool Abrechnung',
      accept: { 'application/json': ['.json'] },
    },
  ],
}

/**
 * Steht der direkte Dateizugriff zur Verfügung?
 *
 * Chrome und Edge definieren showSaveFilePicker/showOpenFilePicker als Funktionen
 * auch unter file:// - verweigern den Dialog dort aber beim eigentlichen Aufruf,
 * ohne die Promise sauber abzulehnen. Reine Feature-Erkennung meldet also
 * faelschlich "verfuegbar", und der Aufruf haengt anschliessend, statt auf den
 * <input type="file">-Fallback zurueckzufallen. Protokoll und Secure-Context
 * deshalb hier mitpruefen, nicht erst in diagnoseFileAccess().
 */
export function isFileSystemAccessSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof (window as Partial<FilePickerWindow>).showSaveFilePicker === 'function' &&
    typeof (window as Partial<FilePickerWindow>).showOpenFilePicker === 'function' &&
    typeof location !== 'undefined' &&
    location.protocol !== 'file:' &&
    (typeof isSecureContext === 'undefined' || isSecureContext)
  )
}

export interface FileAccessDiagnosis {
  available: boolean
  /** Nur gesetzt, wenn der Zugriff fehlt. */
  reason?: 'browser' | 'local-file' | 'insecure'
  /** Nur gesetzt, wenn der Zugriff fehlt: was zu tun ist. */
  hint?: string
}

/** Browser ohne jede Unterstuetzung - dort hilft auch HTTPS nicht. */
function browserLacksApi(): boolean {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent

  const isChromium = /Chrome|Chromium|Edg\//.test(ua)
  const isSafari = /Safari/.test(ua) && !isChromium
  const isFirefox = /Firefox/.test(ua)

  return isSafari || isFirefox
}

/**
 * Warum der direkte Dateizugriff fehlt.
 *
 * Zwei unabhaengige Gruende, die sich nicht vermischen duerfen:
 * Safari und Firefox kennen die File System Access API ueberhaupt nicht, auch
 * nicht ueber HTTPS. Chrome und Edge koennen sie, geben sie aber bei einem Aufruf
 * ueber file:// nicht frei - dort genuegt es, die Seite ueber http(s) auszuliefern.
 */
export function diagnoseFileAccess(): FileAccessDiagnosis {
  if (isFileSystemAccessSupported()) return { available: true }

  if (browserLacksApi()) {
    return {
      available: false,
      reason: 'browser',
      hint:
        'Safari und Firefox unterstützen den direkten Dateizugriff nicht - auch nicht über ' +
        'HTTPS. In Chrome oder Edge geöffnet, schreibt "Speichern" direkt in die Datei.',
    }
  }

  const protocol = typeof location !== 'undefined' ? location.protocol : ''

  if (protocol === 'file:') {
    return {
      available: false,
      reason: 'local-file',
      hint:
        'Die Seite läuft als lokale Datei (file://). Chrome und Edge geben den direkten ' +
        'Dateizugriff dort nicht frei. Über eine http(s)-Adresse ausgeliefert - localhost ' +
        'genügt - funktioniert "Speichern" ohne Download.',
    }
  }

  if (typeof isSecureContext !== 'undefined' && !isSecureContext) {
    return {
      available: false,
      reason: 'insecure',
      hint:
        'Die Seite wird unverschlüsselt ausgeliefert. Der direkte Dateizugriff ist nur ' +
        'über HTTPS oder localhost möglich.',
    }
  }

  return {
    available: false,
    reason: 'browser',
    hint:
      'Dieser Browser unterstützt den direkten Dateizugriff nicht. In Chrome oder Edge ' +
      'geöffnet, speichert die Anwendung direkt in die Datei.',
  }
}

function buildFileContent(state: ProjectState): string {
  const payload: AppFile = {
    formatVersion: '1.0',
    savedAt: new Date().toISOString(),
    savedBy: getCurrentUser() || undefined,
    appVersion: state.appVersion,
    data: state,
  }
  // Kompakt statt eingerueckt: die Datei wird bei jedem Speichern neu zu SharePoint
  // synchronisiert, und Einrueckung blaeht sie um rund die Haelfte auf.
  return JSON.stringify(payload)
}

interface ParsedFile {
  state: ProjectState
  savedBy?: string
  savedAt?: string
}

function parseFileContent(text: string): ParsedFile {
  const parsed = JSON.parse(text)

  // Sowohl das Dateiformat dieser Funktion als auch der ältere JSON-Export
  // aus "Daten" tragen den Zustand unter data.
  const data = parsed?.data ?? parsed

  if (!data || typeof data !== 'object' || !Array.isArray(data.snapshots)) {
    throw new Error('Die Datei enthält keine gültige Abrechnung.')
  }

  const state = repairMissingDocumentNumbers(
    migrateBaselineRevisions(migrateProjectNames(migrateAssignments(reviveDates(data) as ProjectState))),
  )

  return {
    state,
    savedBy: typeof parsed?.savedBy === 'string' ? parsed.savedBy : undefined,
    savedAt: typeof parsed?.savedAt === 'string' ? parsed.savedAt : undefined,
  }
}

/** Vorschlag fuer den Dateinamen beim ersten Speichern. */
const defaultFileName = defaultStateFileName

/** Prüft bzw. erfragt die Schreibberechtigung für einen gemerkten Dateizugriff. */
async function ensureWritePermission(handle: FileHandle): Promise<boolean> {
  if (!handle.queryPermission || !handle.requestPermission) return true

  const options = { mode: 'readwrite' as const }

  if ((await handle.queryPermission(options)) === 'granted') return true
  // Erfordert eine Nutzeraktion - deshalb nur aus Klick-Handlern heraus aufrufen
  return (await handle.requestPermission(options)) === 'granted'
}

async function writeToHandle(handle: FileHandle, content: string): Promise<void> {
  const writable = await handle.createWritable()
  await writable.write(content)
  await writable.close()
}

/** Klassischer Download - Rückfall ohne File System Access API. */
function downloadFile(content: string, fileName: string): void {
  const blob = new Blob([content], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Speichert in die zuletzt geöffnete Datei. Ist keine bekannt oder wird
 * `forcePicker` gesetzt, fragt der Browser nach dem Ablageort.
 */
export async function saveToFile(
  state: ProjectState,
  forcePicker = false
): Promise<{ fileName: string; handle?: FileHandle } | null> {
  const content = buildFileContent(state)

  if (!isFileSystemAccessSupported()) {
    const fileName = defaultFileName()
    downloadFile(content, fileName)
    return { fileName }
  }

  let handle = forcePicker ? undefined : await loadStoredHandle()

  if (handle && !(await ensureWritePermission(handle))) {
    // Berechtigung verweigert - wie ein "Speichern unter" behandeln
    handle = undefined
  }

  if (!handle) {
    try {
      handle = await pickerApi().showSaveFilePicker({
        ...pickerOptions,
        suggestedName: defaultFileName(),
      })
    } catch (err) {
      if (isAbort(err)) return null
      throw err
    }
  }

  await writeToHandle(handle!, content)
  await storeHandle(handle!)

  return { fileName: handle!.name, handle: handle! }
}

/** Öffnet eine Abrechnungsdatei und merkt sich den Zugriff. */
export async function openFromFile(): Promise<OpenResult | null> {
  if (!isFileSystemAccessSupported()) {
    const file = await pickFileViaInput()
    if (!file) return null
    const parsed = parseFileContent(await file.text())
    return { state: parsed.state, fileName: file.name, savedBy: parsed.savedBy, savedAt: parsed.savedAt }
  }

  let handle: FileHandle
  try {
    const [picked] = await pickerApi().showOpenFilePicker({
      ...pickerOptions,
      multiple: false,
    })
    handle = picked
  } catch (err) {
    if (isAbort(err)) return null
    throw err
  }

  const file = await handle.getFile()
  const parsed = parseFileContent(await file.text())
  await storeHandle(handle)

  return { state: parsed.state, fileName: handle.name, handle, savedBy: parsed.savedBy, savedAt: parsed.savedAt }
}

/** Rückfall-Dateiauswahl über ein verstecktes input[type=file]. */
function pickFileViaInput(): Promise<File | null> {
  return new Promise(resolve => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = '.json'
    input.style.display = 'none'

    input.onchange = () => {
      resolve(input.files?.[0] ?? null)
      input.remove()
    }
    // Bricht der Nutzer ab, feuert kein change-Event; das Element bleibt ungenutzt zurück
    input.oncancel = () => {
      resolve(null)
      input.remove()
    }

    document.body.appendChild(input)
    input.click()
  })
}

function isAbort(err: unknown): boolean {
  return err instanceof DOMException && err.name === 'AbortError'
}

// ---- Gemerkter Dateizugriff ----

export async function storeHandle(handle: FileHandle): Promise<void> {
  try {
    await idbSet(STORE_HANDLES, HANDLE_KEY, handle)
  } catch (err) {
    console.warn('Dateizugriff konnte nicht gemerkt werden:', err)
  }
}

export async function loadStoredHandle(): Promise<FileHandle | undefined> {
  try {
    return await idbGet<FileHandle>(STORE_HANDLES, HANDLE_KEY)
  } catch {
    return undefined
  }
}

export async function forgetStoredHandle(): Promise<void> {
  try {
    await idbDelete(STORE_HANDLES, HANDLE_KEY)
  } catch {
    /* egal - der Zugriff war ohnehin nur eine Bequemlichkeit */
  }
}

/**
 * Name der gemerkten Datei, ohne eine Berechtigung anzufordern.
 * Dient nur der Anzeige beim Start.
 */
export async function getStoredFileName(): Promise<string | null> {
  const handle = await loadStoredHandle()
  return handle?.name ?? null
}
