import { useRef, useState } from 'react'
import type { ProjectState, BillingSnapshot, Bundle, Project } from '../types'
import type { ValidationError, ValidationWarning } from '../types'
import { importTimesheetExcel } from '../lib/timesheetImport'
import { collectKnownTimeIds } from '../lib/timesheetImport'
import { findProjectByName, unresolvedChargeableAssignments } from '../lib/roleResolution'
import { appendAuditLog } from '../lib/auditLog'
import '../styles/ImportPanel.css'

/**
 * Legt für jeden Projektnamen aus den Zeiteinträgen ein Projekt an.
 * Bereits vorhandene Projekte bleiben unverändert - sonst gingen PO-Nummer,
 * Budget und Rollen-Zuordnungen bei jedem Import verloren.
 */
function upsertProjects(
  timeEntries: any[],
  existingProjects: Project[],
  bundleId: string
): Project[] {
  const newProjects: Project[] = []
  const projectNames = new Set<string>(
    timeEntries.map(e => e.projectName).filter(Boolean)
  )

  projectNames.forEach(name => {
    const alreadyKnown =
      findProjectByName(name, existingProjects) || findProjectByName(name, newProjects)
    if (alreadyKnown) return

    newProjects.push({
      id: `project-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      bundleId,
      name,
    })
  })

  return [...existingProjects, ...newProjects]
}

function createProjectSnapshots(
  timeEntries: any[],
  employees: any[],
  rateCards: any[],
  bundleId: string,
  monat: string
): BillingSnapshot[] {
  // Group TimeEntries by project
  const projectMap = new Map<string, any[]>()
  timeEntries.forEach(entry => {
    if (!projectMap.has(entry.projectName)) {
      projectMap.set(entry.projectName, [])
    }
    projectMap.get(entry.projectName)!.push(entry)
  })

  // Create snapshot per project
  const snapshots: BillingSnapshot[] = []
  projectMap.forEach((entries, projectName) => {
    // Get unique employees for this project
    const resourceNames = new Set(entries.map(e => e.resource))
    const projectEmployees = employees.filter(e => resourceNames.has(e.name))

    const snapshot: BillingSnapshot = {
      id: `snapshot-${Date.now()}-${projectName.replace(/\s+/g, '-')}`,
      bundleId,
      month: `${monat} - ${projectName}`,
      version: 1,
      locked: false,
      createdAt: new Date(),
      lastModifiedAt: new Date(),
      timeEntries: entries,
      employees: projectEmployees,
      rateCards,
    }
    snapshots.push(snapshot)
  })

  return snapshots
}

interface ImportPanelProps {
  state: ProjectState
  onStateUpdate: (state: ProjectState) => void
}

interface ImportStatus {
  loading: boolean
  success: boolean
  error: string | null
  warnings: ValidationWarning[]
  errors: ValidationError[]
  importedCount: number
  employeeCount: number
  duplicatesInFile: number
  alreadyImported: number
  unresolvedRoles: number
}

const EMPTY_STATUS: ImportStatus = {
  loading: false,
  success: false,
  error: null,
  warnings: [],
  errors: [],
  importedCount: 0,
  employeeCount: 0,
  duplicatesInFile: 0,
  alreadyImported: 0,
  unresolvedRoles: 0,
}

interface BundleForm {
  showNewBundleForm: boolean
  newBundleName: string
}

interface ImportForm {
  selectedMonth: string
  selectedYear: string
}

export function ImportPanel({ state, onStateUpdate }: ImportPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [status, setStatus] = useState<ImportStatus>(EMPTY_STATUS)
  const [selectedBundleId, setSelectedBundleId] = useState<string>('')
  const [bundleForm, setBundleForm] = useState<BundleForm>({
    showNewBundleForm: false,
    newBundleName: '',
  })
  const currentYear = new Date().getFullYear()
  const [importForm, setImportForm] = useState<ImportForm>({
    selectedMonth: '',
    selectedYear: String(currentYear),
  })

  const handleFileSelect = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return

    if (!selectedBundleId) {
      alert('Bitte wählen Sie zuerst ein Bundle aus oder erstellen Sie ein neues.')
      return
    }

    if (!importForm.selectedMonth || !importForm.selectedYear) {
      alert('Bitte wählen Sie einen Monat und ein Jahr aus.')
      return
    }

    setStatus({ ...EMPTY_STATUS, loading: true })

    try {
      // Gegen alles pruefen, was schon in gespeicherten Abrechnungen liegt - sonst
      // erzeugt ein zweiter Import derselben Datei stumm doppelten Umsatz.
      const knownTimeIds = collectKnownTimeIds(state.snapshots)
      const result = await importTimesheetExcel(file, { knownTimeIds })

      if (!result.success) {
        // Wenn nichts uebrig blieb, weil alles schon importiert war, ist die Datei
        // in Ordnung - eine Meldung ueber ein ungueltiges Format waere irrefuehrend.
        const allDuplicates =
          result.stats.alreadyImported > 0 && result.stats.imported === 0

        setStatus({
          ...EMPTY_STATUS,
          error: allDuplicates
            ? `Nichts zu importieren: alle ${result.stats.alreadyImported} Zeiteinträge dieser ` +
              'Datei stecken bereits in einer gespeicherten Abrechnung.'
            : 'Import fehlgeschlagen: Ungültige Excel-Datei',
          warnings: result.warnings,
          errors: allDuplicates ? [] : result.errors,
          duplicatesInFile: result.stats.duplicatesInFile,
          alreadyImported: result.stats.alreadyImported,
        })
        return
      }

      // Frueher wurde hier jeder weitere Import in ein bereits befuelltes Bundle
      // hart abgewiesen. Das machte den Monatsrhythmus unmoeglich - September liess
      // sich nicht in dasselbe Bundle laden wie August. Gegen echte Doppelimporte
      // schuetzt jetzt die TimeId-Pruefung, die einzelne Zeilen abweist statt
      // ganze Dateien.

      // Format monat as "Monthname Year" (e.g., "August 2026")
      const months = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember']
      const monthIndex = parseInt(importForm.selectedMonth) - 1
      const monatFormatted = `${months[monthIndex]} ${importForm.selectedYear}`

      // Auto-create snapshots per project
      const projectSnapshots = createProjectSnapshots(
        result.timeEntries,
        result.employees,
        state.rateCards,
        selectedBundleId,
        monatFormatted
      )

      // Snapshot-Ids anhaengen, nicht ersetzen - sonst verliert das Bundle beim
      // naechsten Monatsimport die Abrechnungen der Vormonate.
      const updatedBundles = state.bundles.map(b => {
        if (b.id === selectedBundleId) {
          return {
            ...b,
            snapshotIds: [...b.snapshotIds, ...projectSnapshots.map(s => s.id)],
            importedAt: new Date(),
          }
        }
        return b
      })

      // Projekte anlegen bzw. bestehende beibehalten (PO-Nummern bleiben erhalten)
      const updatedProjects = upsertProjects(result.timeEntries, state.projects, selectedBundleId)

      // Bestehende Mitarbeiter behalten: an ihnen haengen von Hand korrigierte
      // Rollen und Standorte, die ein Import sonst wieder auf die Vorgabewerte
      // zuruecksetzen wuerde.
      const knownPersonalnummern = new Set(state.employees.map(e => e.personalnummer))
      const newEmployees = result.employees.filter(e => !knownPersonalnummern.has(e.personalnummer))

      const withNewData: ProjectState = {
        ...state,
        bundles: updatedBundles,
        projects: updatedProjects,
        // Anhaengen statt ersetzen - die Dublettenpruefung stellt sicher, dass
        // dabei nichts doppelt hineinlaeuft.
        timeEntries: [...state.timeEntries, ...result.timeEntries],
        employees: [...state.employees, ...newEmployees],
        snapshots: [...state.snapshots, ...projectSnapshots],
        currentSnapshotId: projectSnapshots.length > 0 ? projectSnapshots[0].id : state.currentSnapshotId,
      }

      // Wie viele der neu importierten Zeilen sich keiner Rolle zuordnen lassen -
      // die Klärliste im Reiter "Projekt-Rollen" führt sie im Detail.
      const unresolved = unresolvedChargeableAssignments(
        result.timeEntries,
        withNewData.employees,
        withNewData.projects,
        withNewData.projectAssignments ?? [],
      )

      const updatedState = appendAuditLog(withNewData, 'import', `Import ${result.stats.fileName}`, {
        detail:
          `${result.timeEntries.length} Zeiteinträge, ${newEmployees.length} neue Mitarbeiter, ` +
          `Prüfsumme ${result.stats.checksum}`,
        bundleId: selectedBundleId,
      })

      onStateUpdate(updatedState)

      const projectCount = new Set(result.timeEntries.map(e => e.projectName)).size

      setStatus({
        ...EMPTY_STATUS,
        success: true,
        warnings: result.warnings,
        errors: result.errors,
        importedCount: result.timeEntries.length,
        employeeCount: newEmployees.length,
        duplicatesInFile: result.stats.duplicatesInFile,
        alreadyImported: result.stats.alreadyImported,
        unresolvedRoles: unresolved.length,
      })

      const skipped = result.stats.duplicatesInFile + result.stats.alreadyImported
      const lines = [
        '✅ Import erfolgreich!',
        '',
        `${result.timeEntries.length} Zeiteinträge übernommen`,
        `${newEmployees.length} neue Mitarbeiter`,
        `${projectCount} Abrechnungen pro Projekt erstellt`,
        `${updatedProjects.length - state.projects.length} neue Projekte angelegt`,
      ]
      if (unresolved.length > 0) {
        lines.push(
          '',
          `⚠️ ${unresolved.length} Mitarbeiter-Projekt-Zuordnung(en) ohne Rolle - ` +
            'im Reiter "Projekt-Rollen" unter "Offene Zuordnungen" zuweisen. Ohne sie ' +
            'lässt sich der Monat nicht abschließen.',
        )
      }
      if (result.stats.unclearProductivity > 0) {
        lines.push(
          '',
          `⚠️ ${result.stats.unclearProductivity} Zeile(n) mit unbekannter Produktivitäts-` +
            'Kennzeichnung - vorerst als produktiv angenommen, siehe Warnungen unten.',
        )
      }
      if (skipped > 0) {
        lines.push('', `${skipped} Zeile(n) als Dublette übersprungen:`)
        if (result.stats.alreadyImported > 0) {
          lines.push(`  ${result.stats.alreadyImported} bereits in früheren Abrechnungen`)
        }
        if (result.stats.duplicatesInFile > 0) {
          lines.push(`  ${result.stats.duplicatesInFile} doppelt in dieser Datei`)
        }
      }

      setTimeout(() => alert(lines.join('\n')), 500)

      if (fileInputRef.current) {
        fileInputRef.current.value = ''
      }
      setSelectedBundleId('')
      setBundleForm({ showNewBundleForm: false, newBundleName: '' })
      setImportForm({ selectedMonth: '', selectedYear: String(currentYear) })
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unbekannter Fehler'
      setStatus({ ...EMPTY_STATUS, error: 'Fehler beim Hochladen: ' + errorMessage })
    }
  }

  const handleCreateBundle = () => {
    if (!bundleForm.newBundleName.trim()) {
      alert('Bitte geben Sie einen Bundle-Namen ein.')
      return
    }

    const newBundle: Bundle = {
      id: `bundle-${Date.now()}`,
      name: bundleForm.newBundleName.trim(),
      snapshotIds: [],
      importedAt: new Date(),
    }

    const updatedState: ProjectState = {
      ...state,
      bundles: [...state.bundles, newBundle],
    }

    onStateUpdate(updatedState)
    setSelectedBundleId(newBundle.id)
    setBundleForm({ showNewBundleForm: false, newBundleName: '' })
  }

  const handleReset = () => {
    setStatus(EMPTY_STATUS)
    if (fileInputRef.current) {
      fileInputRef.current.value = ''
    }
  }

  return (
    <section className="import-panel">
      <h2>Zeiteinträge importieren</h2>
      <p className="import-description">
        Laden Sie die "Details of Time Entries" Excel-Datei hoch. Zeiteinträge und Mitarbeiter werden automatisch importiert, klassifiziert und dedupliziert.
      </p>

      <div className="import-bundle-section">
        <h3>1. Bundle auswählen oder erstellen</h3>
        {state.bundles.length > 0 && (
          <div className="import-bundle-select">
            <label htmlFor="bundle-select">Bundle:</label>
            <select
              id="bundle-select"
              value={selectedBundleId}
              onChange={(e) => setSelectedBundleId(e.target.value)}
              disabled={status.loading}
            >
              <option value="">-- Bitte auswählen --</option>
              {state.bundles.map(bundle => (
                <option key={bundle.id} value={bundle.id}>
                  {bundle.name} {bundle.snapshotIds.length > 0 ? '✅' : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        {!bundleForm.showNewBundleForm ? (
          <button
            className="import-button-secondary"
            onClick={() => setBundleForm({ ...bundleForm, showNewBundleForm: true })}
            disabled={status.loading}
          >
            + Neues Bundle erstellen
          </button>
        ) : (
          <div className="import-bundle-form">
            <input
              type="text"
              placeholder="Bundle-Name (z.B. 'Q3 2026', 'Projekt Alpha')"
              value={bundleForm.newBundleName}
              onChange={(e) => setBundleForm({ ...bundleForm, newBundleName: e.target.value })}
              disabled={status.loading}
            />
            <button
              className="import-button-primary"
              onClick={handleCreateBundle}
              disabled={status.loading}
            >
              Erstellen
            </button>
            <button
              className="import-button-secondary"
              onClick={() => setBundleForm({ showNewBundleForm: false, newBundleName: '' })}
              disabled={status.loading}
            >
              Abbrechen
            </button>
          </div>
        )}
      </div>

      {selectedBundleId && (
        <div className="import-monat-section">
          <h3>2. Abrechnungsmonat auswählen</h3>
          <div className="import-monat-selects">
            <select
              value={importForm.selectedMonth}
              onChange={(e) => setImportForm({ ...importForm, selectedMonth: e.target.value })}
              disabled={status.loading}
              className="import-monat-select"
            >
              <option value="">-- Monat --</option>
              <option value="1">Januar</option>
              <option value="2">Februar</option>
              <option value="3">März</option>
              <option value="4">April</option>
              <option value="5">Mai</option>
              <option value="6">Juni</option>
              <option value="7">Juli</option>
              <option value="8">August</option>
              <option value="9">September</option>
              <option value="10">Oktober</option>
              <option value="11">November</option>
              <option value="12">Dezember</option>
            </select>
            <select
              value={importForm.selectedYear}
              onChange={(e) => setImportForm({ ...importForm, selectedYear: e.target.value })}
              disabled={status.loading}
              className="import-monat-select"
            >
              <option value="">-- Jahr --</option>
              {[currentYear - 2, currentYear - 1, currentYear, currentYear + 1, currentYear + 2].map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      {selectedBundleId && (
        <div className="import-upload-area">
          <h3>3. Datei hochladen</h3>
          <input
            ref={fileInputRef}
            type="file"
            accept=".xlsx,.xls"
            onChange={handleFileSelect}
            disabled={status.loading}
            id="file-input"
            className="import-file-input"
            aria-label="Excel-Datei hochladen"
          />
          <label htmlFor="file-input" className="import-upload-button">
            {status.loading ? '⏳ Wird verarbeitet...' : '📁 Excel-Datei auswählen'}
          </label>
        </div>
      )}

      {status.error && (
        <div className="import-alert import-alert-error">
          <strong>❌ Fehler:</strong> {status.error}
        </div>
      )}

      {status.success && (
        <div className="import-alert import-alert-success">
          <strong>✅ Erfolgreich!</strong> {status.importedCount} Zeiteinträge importiert,{' '}
          {status.employeeCount} neue Mitarbeiter.
        </div>
      )}

      {status.unresolvedRoles > 0 && (
        <div className="import-alert import-alert-error">
          <strong>⚠️ {status.unresolvedRoles} Zuordnung(en) ohne Rolle.</strong> Im Reiter
          "Projekt-Rollen" unter "Offene Zuordnungen" zuweisen — ohne sie lässt sich der Monat
          nicht abschließen.
        </div>
      )}

      {(status.alreadyImported > 0 || status.duplicatesInFile > 0) && (
        <div className="import-alert import-alert-duplicate">
          <strong>🔁 Dubletten übersprungen</strong>
          <ul>
            {status.alreadyImported > 0 && (
              <li>
                <strong>{status.alreadyImported}</strong> Zeile(n) stecken bereits in einer
                früheren Abrechnung — sie wurden nicht erneut übernommen.
              </li>
            )}
            {status.duplicatesInFile > 0 && (
              <li>
                <strong>{status.duplicatesInFile}</strong> Zeile(n) kommen in dieser Datei
                mehrfach mit derselben TimeId vor.
              </li>
            )}
          </ul>
        </div>
      )}

      {status.warnings.length > 0 && (
        <div className="import-warnings">
          <h3>⚠️ Warnungen ({status.warnings.length})</h3>
          <ul className="import-message-list">
            {status.warnings.map((warning, idx) => (
              <li key={idx}>
                <span className="import-message-row">Z. {warning.row}</span>
                <span className="import-message-text">{warning.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {status.errors.length > 0 && (
        <div className="import-errors">
          <h3>🚫 Fehler ({status.errors.length})</h3>
          <ul className="import-message-list">
            {status.errors.map((error, idx) => (
              <li key={idx}>
                <span className="import-message-row">Z. {error.row}</span>
                <span className="import-message-text">{error.message}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(status.success || status.error) && (
        <div className="import-actions">
          <button className="import-reset-button" onClick={handleReset}>
            Zurücksetzen
          </button>
        </div>
      )}
    </section>
  )
}
