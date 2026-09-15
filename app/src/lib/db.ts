/**
 * Schlanker IndexedDB-Zugriff ohne Fremdbibliothek.
 *
 * Gegenüber localStorage zwei Vorteile: das Limit liegt bei einem Anteil der freien
 * Festplatte statt bei 5 MB, und structuredClone erhält Date-Objekte - die Rückwandlung
 * von Datums-Strings entfällt hier vollständig.
 */

const DB_NAME = 'flexteams-closing-tool'
const DB_VERSION = 1

/** Anwendungszustand, ein Datensatz unter fester Id. */
const STORE_STATE = 'state'
/** Dateizugriffe (FileSystemFileHandle) - ebenfalls strukturiert klonbar. */
const STORE_HANDLES = 'handles'

let dbPromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(STORE_STATE)) {
        db.createObjectStore(STORE_STATE)
      }
      if (!db.objectStoreNames.contains(STORE_HANDLES)) {
        db.createObjectStore(STORE_HANDLES)
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error ?? new Error('IndexedDB nicht verfügbar'))
    request.onblocked = () => reject(new Error('IndexedDB blockiert - bitte andere Tabs schließen'))
  })

  // Ein fehlgeschlagener Versuch darf nicht dauerhaft zwischengespeichert bleiben
  dbPromise.catch(() => {
    dbPromise = null
  })

  return dbPromise
}

function runTransaction<T>(
  store: string,
  mode: IDBTransactionMode,
  work: (objectStore: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  return openDatabase().then(
    db =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode)
        const request = work(tx.objectStore(store))

        request.onsuccess = () => resolve(request.result)
        request.onerror = () => reject(request.error)
        tx.onabort = () => reject(tx.error ?? new Error('Transaktion abgebrochen'))
      })
  )
}

export function idbGet<T>(store: string, key: string): Promise<T | undefined> {
  return runTransaction<T | undefined>(store, 'readonly', s => s.get(key) as IDBRequest<T | undefined>)
}

export function idbSet(store: string, key: string, value: unknown): Promise<unknown> {
  return runTransaction(store, 'readwrite', s => s.put(value, key))
}

export function idbDelete(store: string, key: string): Promise<unknown> {
  return runTransaction(store, 'readwrite', s => s.delete(key))
}

export function isIndexedDBAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null
  } catch {
    return false
  }
}

/**
 * Wie viel Platz der Browser der Anwendung zugesteht und wie viel schon belegt ist.
 * Nicht jeder Browser liefert das - dann bleibt das Ergebnis null.
 */
export async function estimateStorage(): Promise<{ usedMB: number; quotaMB: number } | null> {
  if (!navigator.storage?.estimate) return null

  try {
    const { usage, quota } = await navigator.storage.estimate()
    if (usage === undefined || quota === undefined) return null
    return {
      usedMB: usage / (1024 * 1024),
      quotaMB: quota / (1024 * 1024),
    }
  } catch {
    return null
  }
}

export { STORE_STATE, STORE_HANDLES }
