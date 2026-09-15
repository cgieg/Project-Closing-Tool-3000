import { useRef, useState } from 'react'
import type { AuditLogCategory, ProjectState } from '../types'
import { exportData, importData, mergeImportedData } from '../lib/dataExportImport'
import { getCurrentUser, setCurrentUser } from '../lib/currentUser'
import { auditLogOf } from '../lib/auditLog'
import { BundleEditor } from './BundleEditor'
import { ProjectEditor } from './ProjectEditor'
import '../styles/DataManagement.css'

const CATEGORY_LABEL: Record<AuditLogCategory, string> = {
  import: 'Import',
  change: 'Änderung',
  freigabe: 'Freigabe',
  export: 'Export',
}

interface DataManagementProps {
  state: ProjectState
  onStateUpdate: (state: ProjectState) => void
}

interface ImportOptions {
  replaceRateCards: boolean
  replaceEmployees: boolean
  replaceRoles: boolean
  mergeSnapshots: boolean
}

export function DataManagement({ state, onStateUpdate }: DataManagementProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [importOptions, setImportOptions] = useState<ImportOptions>({
    replaceRateCards: false,
    replaceEmployees: false,
    replaceRoles: false,
    mergeSnapshots: true,
  })
  const [importStatus, setImportStatus] = useState<{ message: string; type: 'success' | 'error' | null }>({
    message: '',
    type: null,
  })
  const [userName, setUserName] = useState(getCurrentUser())
  const [logFilter, setLogFilter] = useState<AuditLogCategory | 'alle'>('alle')

  const handleSaveUser = () => {
    setCurrentUser(userName)
  }

  const log = auditLogOf(state).filter(e => logFilter === 'alle' || e.category === logFilter)

  const handleExport = () => {
    exportData(state)
    setImportStatus({
      message: '✅ Daten erfolgreich exportiert',
      type: 'success',
    })
    setTimeout(() => setImportStatus({ message: '', type: null }), 3000)
  }

  const handleImportFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    try {
      const importedData = await importData(file)
      const merged = mergeImportedData(state, importedData.data, importOptions)
      onStateUpdate(merged)

      const counts = {
        rateCards: importedData.data.rateCards?.length || 0,
        employees: importedData.data.employees?.length || 0,
        roles: importedData.data.roles?.length || 0,
        snapshots: importedData.data.snapshots?.length || 0,
        bundles: importedData.data.bundles?.length || 0,
      }

      setImportStatus({
        message: `✅ Import erfolgreich! ${counts.rateCards} RateCards, ${counts.employees} MA, ${counts.roles} Rollen, ${counts.snapshots} Abrechnungen, ${counts.bundles} Bundles`,
        type: 'success',
      })

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }

      setTimeout(() => setImportStatus({ message: '', type: null }), 5000)
    } catch (error) {
      setImportStatus({
        message: `❌ ${error instanceof Error ? error.message : 'Fehler beim Import'}`,
        type: 'error',
      })
    }
  }

  return (
    <section className="data-management">
      <div className="data-management-header">
        <h3>📦 Daten-Management</h3>
        <p>Speichern Sie Ihre Abrechnungen, Mitarbeiter und RateCards für die Zukunft</p>
      </div>

      <div className="data-management-content">
        {/* Export Section */}
        <div className="data-management-section">
          <h4>📥 Daten exportieren</h4>
          <p className="section-description">Speichern Sie alle aktuellen Daten (Abrechnungen, Mitarbeiter, RateCards, Bundles) als JSON-Datei</p>

          <div className="export-stats">
            <div className="stat">
              <span className="stat-label">Abrechnungen:</span>
              <span className="stat-value">{state.snapshots?.length || 0}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Mitarbeiter:</span>
              <span className="stat-value">{state.employees?.length || 0}</span>
            </div>
            <div className="stat">
              <span className="stat-label">RateCards:</span>
              <span className="stat-value">{state.rateCards?.length || 0}</span>
            </div>
            <div className="stat">
              <span className="stat-label">Bundles:</span>
              <span className="stat-value">{state.bundles?.length || 0}</span>
            </div>
          </div>

          <button className="data-export-button" onClick={handleExport}>
            💾 Alles exportieren
          </button>
        </div>

        {/* Import Section */}
        <div className="data-management-section">
          <h4>📤 Daten importieren</h4>
          <p className="section-description">Laden Sie eine zuvor exportierte JSON-Datei um alte Daten wiederherzustellen</p>

          <div className="import-options">
            <label className="import-option">
              <input
                type="checkbox"
                checked={importOptions.replaceRateCards}
                onChange={(e) =>
                  setImportOptions({ ...importOptions, replaceRateCards: e.target.checked })
                }
              />
              <span>RateCards ersetzen (nicht zusammenführen)</span>
            </label>

            <label className="import-option">
              <input
                type="checkbox"
                checked={importOptions.replaceEmployees}
                onChange={(e) =>
                  setImportOptions({ ...importOptions, replaceEmployees: e.target.checked })
                }
              />
              <span>Mitarbeiter ersetzen (nicht zusammenführen)</span>
            </label>

            <label className="import-option">
              <input
                type="checkbox"
                checked={importOptions.replaceRoles}
                onChange={(e) => setImportOptions({ ...importOptions, replaceRoles: e.target.checked })}
              />
              <span>Rollen ersetzen (nicht zusammenführen)</span>
            </label>

            <label className="import-option">
              <input
                type="checkbox"
                checked={importOptions.mergeSnapshots}
                onChange={(e) =>
                  setImportOptions({ ...importOptions, mergeSnapshots: e.target.checked })
                }
              />
              <span>Abrechnungen zusammenführen (empfohlen)</span>
            </label>
          </div>

          <div className="import-file-section">
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              onChange={handleImportFile}
              id="data-import-input"
              className="data-import-input"
              aria-label="JSON-Datei importieren"
            />
            <label htmlFor="data-import-input" className="data-import-button">
              📂 JSON-Datei auswählen
            </label>
          </div>
        </div>
      </div>

      {importStatus.message && (
        <div className={`import-status ${importStatus.type}`}>
          {importStatus.message}
        </div>
      )}

      {/* Bearbeitername je Arbeitsplatz - ohne Anmeldung der einzige Weg, Fassungen,
          Freigaben und Exporte einem Verantwortlichen zuzuordnen. */}
      <div className="data-management-section" style={{ marginTop: '32px' }}>
        <h4>👤 Bearbeiter</h4>
        <p className="section-description">
          Wird in jede Fassung, Freigabe und jeden Export geschrieben - je Arbeitsplatz einmal
          setzen.
        </p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="text"
            value={userName}
            onChange={e => setUserName(e.target.value)}
            placeholder="Ihr Name"
            style={{ padding: '6px 10px' }}
          />
          <button className="data-export-button" onClick={handleSaveUser}>
            Speichern
          </button>
        </div>
      </div>

      {/* Prüfpfad: Import-, Änderungs-, Freigabe- und Exportprotokoll in einem. */}
      <div className="data-management-section" style={{ marginTop: '24px' }}>
        <h4>🧾 Protokoll</h4>
        <p className="section-description">
          Import, Änderungen an Rollen und Rate Cards, Freigaben und Exporte - {log.length} von{' '}
          {(state.auditLog ?? []).length} Einträgen angezeigt.
        </p>
        <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
          {(['alle', 'import', 'change', 'freigabe', 'export'] as const).map(cat => (
            <button
              key={cat}
              className="data-export-button"
              style={{ opacity: logFilter === cat ? 1 : 0.55 }}
              onClick={() => setLogFilter(cat)}
            >
              {cat === 'alle' ? 'Alle' : CATEGORY_LABEL[cat]}
            </button>
          ))}
        </div>
        {log.length === 0 ? (
          <p className="section-description">Noch keine Einträge.</p>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="rce-table">
              <thead>
                <tr>
                  <th>Zeitpunkt</th>
                  <th>Kategorie</th>
                  <th>Bearbeiter</th>
                  <th>Meldung</th>
                  <th>Detail</th>
                </tr>
              </thead>
              <tbody>
                {log.slice(0, 200).map(entry => (
                  <tr key={entry.id}>
                    <td>{new Date(entry.at).toLocaleString('de-DE')}</td>
                    <td>{CATEGORY_LABEL[entry.category]}</td>
                    <td>{entry.by}</td>
                    <td>{entry.message}</td>
                    <td className="project-muted">{entry.detail ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {log.length > 200 && (
              <p className="section-description">{log.length - 200} weitere Einträge, älteste zuerst gekürzt.</p>
            )}
          </div>
        )}
      </div>

      {/* Stammdaten - lassen sich vor dem ersten Import vorbereiten */}
      <div className="data-management-section" style={{ marginTop: '32px' }}>
        <h4>📦 Bundles</h4>
        <BundleEditor state={state} onStateUpdate={onStateUpdate} />
      </div>

      <div className="data-management-section" style={{ marginTop: '24px' }}>
        <h4>🎯 Projekte</h4>
        <ProjectEditor state={state} onStateUpdate={onStateUpdate} />
      </div>
    </section>
  )
}
