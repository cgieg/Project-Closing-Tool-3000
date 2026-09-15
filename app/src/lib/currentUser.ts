/**
 * Bearbeitername je Arbeitsplatz.
 *
 * Ohne Anmeldung (SSO kommt erst mit dem Backend in Version 2) gibt es keinen
 * Benutzer, dem sich eine Änderung, Freigabe oder ein Export zuordnen ließe.
 * Als Übergangslösung setzt jeder Arbeitsplatz einmal seinen Namen - lokal
 * gespeichert, nicht fälschungssicher, aber nachvollziehbar.
 */
const STORAGE_KEY = 'flexteams-current-user'

export function getCurrentUser(): string {
  try {
    return localStorage.getItem(STORAGE_KEY)?.trim() || ''
  } catch {
    return ''
  }
}

export function setCurrentUser(name: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, name.trim())
  } catch {
    /* egal - ohne localStorage bleibt der Bearbeitername für diese Sitzung leer */
  }
}

/**
 * Liefert den gesetzten Namen oder fragt einmalig danach.
 * Für Aktionen, die einen Bearbeiter im Protokoll brauchen (Freigabe, Export).
 */
export function ensureCurrentUser(): string {
  const existing = getCurrentUser()
  if (existing) return existing

  const entered = (typeof window !== 'undefined' ? window.prompt(
    'Ihr Name für Protokoll und Freigabe (einmalig je Arbeitsplatz):'
  ) : null)?.trim()

  if (entered) {
    setCurrentUser(entered)
    return entered
  }

  return 'Unbekannt'
}
