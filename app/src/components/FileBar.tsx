import { useEffect, useState } from 'react'
import type { ProjectState } from '../types'
import { diagnoseFileAccess, getStoredFileName, openFromFile, saveToFile } from '../lib/fileSync'
import { getCurrentUser } from '../lib/currentUser'
import '../styles/FileBar.css'

interface FileBarProps {
  state: ProjectState
  /** Ungesicherte Änderungen seit dem letzten Schreiben in die Datei. */
  dirty: boolean
  onStateReplace: (state: ProjectState) => void
  onSaved: () => void
}

type Status = { kind: 'idle' | 'busy' | 'ok' | 'error' | 'warn'; message?: string }

export function FileBar({ state, dirty, onStateReplace, onSaved }: FileBarProps) {
  const [fileName, setFileName] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>({ kind: 'idle' })
  const [savedBy, setSavedBy] = useState<string | null>(null)
  const diagnosis = diagnoseFileAccess()
  const supported = diagnosis.available
  const hint = diagnosis.available ? null : diagnosis.hint

  // Beim Start nur den Namen zeigen - eine Berechtigung wird erst beim Speichern erfragt
  useEffect(() => {
    void getStoredFileName().then(setFileName)
  }, [])

  const report = (kind: Status['kind'], message?: string) => {
    setStatus({ kind, message })
    if (kind === 'ok') setTimeout(() => setStatus({ kind: 'idle' }), 2500)
  }

  const handleSave = async (forcePicker: boolean) => {
    setStatus({ kind: 'busy' })
    try {
      const result = await saveToFile(state, forcePicker)
      if (!result) {
        setStatus({ kind: 'idle' })
        return
      }
      setFileName(result.fileName)
      setSavedBy(getCurrentUser() || null)
      onSaved()
      report('ok', supported ? `Gespeichert: ${result.fileName}` : `Heruntergeladen: ${result.fileName}`)
    } catch (err) {
      report('error', err instanceof Error ? err.message : 'Speichern fehlgeschlagen')
    }
  }

  const handleOpen = async () => {
    if (dirty && !confirm('Es gibt ungesicherte Änderungen. Trotzdem eine andere Datei öffnen?')) {
      return
    }

    setStatus({ kind: 'busy' })
    try {
      const result = await openFromFile()
      if (!result) {
        setStatus({ kind: 'idle' })
        return
      }
      onStateReplace(result.state)
      setFileName(result.fileName)
      setSavedBy(result.savedBy ?? null)
      onSaved()

      // Warnung bei fremdem Stand: eine andere Person als die hier eingetragene
      // hat zuletzt gespeichert. Blockiert nichts, macht es nur sichtbar.
      const me = getCurrentUser()
      if (result.savedBy && me && result.savedBy !== me) {
        const when = result.savedAt ? new Date(result.savedAt).toLocaleString('de-DE') : 'unbekannt'
        report(
          'warn',
          `Achtung: zuletzt gespeichert von ${result.savedBy} am ${when} — abweichend von Ihrem Namen (${me}).`,
        )
      } else {
        report('ok', `Geöffnet: ${result.fileName}`)
      }
    } catch (err) {
      report('error', err instanceof Error ? err.message : 'Öffnen fehlgeschlagen')
    }
  }

  const busy = status.kind === 'busy'

  return (
    <div className="filebar">
      <div className="filebar-file">
        <span className="filebar-icon" aria-hidden="true">📄</span>
        {fileName ? (
          <>
            <span className="filebar-name" title={fileName}>{fileName}</span>
            {dirty && <span className="filebar-dirty" title="Ungesicherte Änderungen">•</span>}
            {savedBy && (
              <span className="filebar-status" title="Zuletzt gespeichert von">
                · {savedBy}
              </span>
            )}
          </>
        ) : (
          <span className="filebar-name filebar-none">Keine Datei verknüpft</span>
        )}
      </div>

      {status.message && (
        <span
          className={`filebar-status filebar-status-${status.kind === 'warn' ? 'error' : status.kind}`}
          role="status"
        >
          {status.message}
        </span>
      )}

      <div className="filebar-actions">
        <button className="filebar-btn" onClick={handleOpen} disabled={busy}>
          Öffnen
        </button>
        <button className="filebar-btn filebar-btn-primary" onClick={() => handleSave(false)} disabled={busy}>
          {busy ? 'Läuft…' : 'Speichern'}
        </button>
        {supported && (
          <button className="filebar-btn" onClick={() => handleSave(true)} disabled={busy}>
            Speichern unter…
          </button>
        )}
      </div>

      {hint && (
        <span className="filebar-hint">
          <strong>Speichern lädt herunter statt direkt zu schreiben.</strong> {hint}
        </span>
      )}
    </div>
  )
}
