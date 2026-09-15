import { useState } from 'react'
import type { ProjectState } from '../types'
import { billingForSnapshots, bundleSummary } from '../lib/billingAggregation'
import { formatDays, formatHours } from '../lib/rounding'
import { buildPdfForSnapshot, leistungsnachweisFileName } from '../lib/leistungsnachweisPdf'
import { findProjectByName } from '../lib/roleResolution'
import { appendAuditLog } from '../lib/auditLog'
import JSZip from 'jszip'
import '../styles/BundleUebersicht.css'

interface BundleUebersichtProps {
  state: ProjectState
  onStateUpdate?: (state: ProjectState) => void
}

interface BundleManage {
  editingBundleId: string | null
  editName: string
}

export function BundleUebersicht({ state, onStateUpdate }: BundleUebersichtProps) {
  if (!onStateUpdate) {
    return (
      <section className="bundle-uebersicht">
        <p>Bundle-Übersicht erfordert onStateUpdate Callback</p>
      </section>
    )
  }
  const [selectedBundleId, setSelectedBundleId] = useState<string>('')
  const [selectedSnapshots, setSelectedSnapshots] = useState<Set<string>>(new Set())
  const [bundleManage, setBundleManage] = useState<BundleManage>({
    editingBundleId: null,
    editName: '',
  })

  // When bundle is selected, get its snapshots
  const currentBundle = state.bundles.find(b => b.id === selectedBundleId)
  const bundleSnapshots = currentBundle
    ? state.snapshots.filter(s => currentBundle.snapshotIds.includes(s.id))
    : []

  const toggleSnapshot = (snapshotId: string) => {
    const newSelected = new Set(selectedSnapshots)
    if (newSelected.has(snapshotId)) {
      newSelected.delete(snapshotId)
    } else {
      newSelected.add(snapshotId)
    }
    setSelectedSnapshots(newSelected)
  }

  const handleEditBundle = (bundleId: string, currentName: string) => {
    setBundleManage({ editingBundleId: bundleId, editName: currentName })
  }

  const handleSaveBundle = (bundleId: string) => {
    if (!bundleManage.editName.trim()) {
      alert('Bundle-Name darf nicht leer sein')
      return
    }

    const updatedBundles = state.bundles.map(b =>
      b.id === bundleId ? { ...b, name: bundleManage.editName.trim() } : b
    )

    onStateUpdate({ ...state, bundles: updatedBundles })
    setBundleManage({ editingBundleId: null, editName: '' })
  }

  const handleDeleteBundle = (bundleId: string) => {
    // Dieselbe Sperre wie im Reiter "Daten" (BundleEditor) - sonst bleiben
    // Projekte mit einer bundleId zurück, die es nicht mehr gibt.
    const bundle = state.bundles.find(b => b.id === bundleId)
    const projectCount = state.projects.filter(p => p.bundleId === bundleId).length
    const snapshotCount = bundle?.snapshotIds.length ?? 0

    if (projectCount > 0 || snapshotCount > 0) {
      alert(
        `"${bundle?.name ?? bundleId}" hat noch ${projectCount} Projekt(e) und ${snapshotCount} Abrechnung(en). ` +
          'Erst diese entfernen, dann lässt sich das Bundle löschen.'
      )
      return
    }

    if (!confirm('Möchten Sie dieses Bundle wirklich löschen?')) return

    const updatedBundles = state.bundles.filter(b => b.id !== bundleId)
    const updatedSnapshots = state.snapshots.filter(s => s.bundleId !== bundleId)

    onStateUpdate({
      ...state,
      bundles: updatedBundles,
      snapshots: updatedSnapshots,
    })
  }

  // Dieselbe Rechnung wie Dashboard und Einzelabrechnung - keine zweite Summenbildung.
  const billings = billingForSnapshots(state, selectedSnapshots)
  const summary = bundleSummary(billings)
  const selectedSnapshotCount = selectedSnapshots.size

  const selectedEntries = state.snapshots
    .filter(s => selectedSnapshots.has(s.id))
    .reduce((sum, s) => sum + s.timeEntries.length, 0)

  // Vereinigungsmenge, nicht das Maximum einer einzelnen Abrechnung
  const employeeCount = new Set(
    state.snapshots
      .filter(s => selectedSnapshots.has(s.id))
      .flatMap(s => s.employees.map(e => e.personalnummer))
  ).size

  const currency = (v: number) =>
    `${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
  const snapshotList = bundleSnapshots.filter(s => selectedSnapshots.has(s.id))

  const handleExportPDF = async () => {
    if (snapshotList.length === 0) {
      alert('Bitte mindestens eine Abrechnung auswählen')
      return
    }

    try {
      // JSZip statisch eingebunden. Frueher kam es von einem CDN - das scheitert
      // offline und im abgeschotteten Firmennetz, also genau dort, wo dieses
      // Werkzeug laeuft. Kein dynamisches import(): vite-plugin-singlefile inlint
      // alles in eine Datei und laesst dabei den __VITE_PRELOAD__-Platzhalter stehen.
      const zip = new JSZip()

      snapshotList.forEach(snapshot => {
        const project = findProjectByName(
          snapshot.timeEntries[0]?.projectName ?? '',
          state.projects
        )
        const doc = buildPdfForSnapshot(state, snapshot)
        // arraybuffer statt blob: JSZip nimmt beides, arraybuffer aber ohne
        // Ruecksicht auf die Blob-Unterstuetzung der Umgebung.
        zip.file(leistungsnachweisFileName(snapshot, project), doc.output('arraybuffer'))
      })

      const zipBlob = await zip.generateAsync({ type: 'blob' })
      const url = URL.createObjectURL(zipBlob)
      const link = document.createElement('a')
      link.href = url
      link.download = `Leistungsnachweise_${new Date().toISOString().slice(0, 10)}.zip`
      document.body.appendChild(link)
      link.click()
      document.body.removeChild(link)
      URL.revokeObjectURL(url)

      onStateUpdate(
        appendAuditLog(
          state,
          'export',
          `${snapshotList.length} Leistungsnachweis(e) als ZIP exportiert`,
          { bundleId: currentBundle?.id, detail: currentBundle?.name },
        ),
      )
    } catch (error) {
      console.error('Export fehlgeschlagen:', error)
      alert(
        'Export fehlgeschlagen: ' +
          (error instanceof Error ? error.message : 'Unbekannter Fehler')
      )
    }
  }

  return (
    <section className="bundle-uebersicht">
      <h2>Bundle-Übersicht</h2>
      <p className="bundle-description">
        Wählen Sie ein Bundle und verwalten Sie die Abrechnungen pro Monat.
      </p>

      {state.bundles.length === 0 ? (
        <div className="bundle-empty-state">
          <p>Keine Bundles vorhanden. Erstellen Sie ein neues Bundle beim Import.</p>
        </div>
      ) : (
        <>
          {/* Bundle Navigation */}
          <div className="bundle-nav-section">
            <h3>Bundles</h3>
            <div className="bundle-nav-buttons">
              {state.bundles.map(bundle => (
                <button
                  key={bundle.id}
                  className={`bundle-nav-btn ${selectedBundleId === bundle.id ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedBundleId(bundle.id)
                    setSelectedSnapshots(new Set(bundleSnapshots.map(s => s.id)))
                  }}
                  title={bundle.name}
                >
                  <div className="bundle-nav-name">{bundle.name}</div>
                  <div className="bundle-nav-count">{bundle.snapshotIds.length} Abrechnungen</div>
                </button>
              ))}
            </div>
          </div>

          {/* Bundle Management (Edit/Delete) */}
          {selectedBundleId && (
            <div className="bundle-management-section">
              <h3>Bundle verwalten</h3>
              <div className="bundle-manage-card">
                {bundleManage.editingBundleId === selectedBundleId ? (
                  <div className="bundle-manage-edit">
                    <input
                      type="text"
                      value={bundleManage.editName}
                      onChange={(e) => setBundleManage({ ...bundleManage, editName: e.target.value })}
                      className="bundle-edit-input"
                      autoFocus
                      placeholder="Bundle-Name"
                    />
                    <button
                      className="bundle-action-btn save"
                      onClick={() => handleSaveBundle(selectedBundleId)}
                      title="Speichern"
                    >
                      Speichern
                    </button>
                    <button
                      className="bundle-action-btn cancel"
                      onClick={() => setBundleManage({ editingBundleId: null, editName: '' })}
                      title="Abbrechen"
                    >
                      Abbrechen
                    </button>
                  </div>
                ) : (
                  <div className="bundle-manage-view">
                    <div className="bundle-manage-info">
                      <strong>{currentBundle?.name}</strong>
                    </div>
                    <button
                      className="bundle-action-btn edit"
                      onClick={() => handleEditBundle(selectedBundleId, currentBundle?.name || '')}
                      title="Bearbeiten"
                    >
                      ✎ Bearbeiten
                    </button>
                    <button
                      className="bundle-action-btn delete"
                      onClick={() => {
                        handleDeleteBundle(selectedBundleId)
                        setSelectedBundleId('')
                      }}
                      title="Löschen"
                    >
                      🗑 Löschen
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}

          {selectedBundleId && bundleSnapshots.length > 0 && (
            <>
              <div className="bundle-snapshots-section">
                <h3>Abrechnungen auswählen ({bundleSnapshots.length})</h3>
                <div className="bundle-snapshots-list">
                  {bundleSnapshots.map(snapshot => (
                    <label key={snapshot.id} className="bundle-snapshot-checkbox">
                      <input
                        type="checkbox"
                        checked={selectedSnapshots.has(snapshot.id)}
                        onChange={() => toggleSnapshot(snapshot.id)}
                      />
                      <span className="bundle-snapshot-name">{snapshot.month}</span>
                      <span className="bundle-snapshot-meta">
                        v{snapshot.version} • {snapshot.timeEntries.length} Einträge • {snapshot.employees.length} MA
                      </span>
                    </label>
                  ))}
                </div>
              </div>

              {selectedSnapshotCount > 0 && (
                <>
                  <div className="bundle-summary">
                    <h3>Zusammenfassung</h3>
                    <div className="bundle-summary-grid">
                      <div className="bundle-summary-item is-primary">
                        <span className="label">Umsatz</span>
                        <span className="value">{currency(summary.betrag)}</span>
                      </div>
                      <div className="bundle-summary-item">
                        <span className="label">Blended Rate</span>
                        <span className="value">{currency(summary.blendedRate)}</span>
                      </div>
                      <div className="bundle-summary-item">
                        <span className="label">Tage</span>
                        <span className="value">{formatDays(summary.days)}</span>
                      </div>
                      <div className="bundle-summary-item">
                        <span className="label">Stunden</span>
                        <span className="value">{formatHours(summary.hours)}</span>
                      </div>
                      <div className="bundle-summary-item">
                        <span className="label">Fakturierungsquote</span>
                        <span className="value">{summary.billableShare.toFixed(1)} %</span>
                      </div>
                      <div className="bundle-summary-item">
                        <span className="label">Mitarbeiter</span>
                        <span className="value">{employeeCount}</span>
                      </div>
                    </div>
                    <p className="bundle-summary-note">
                      {selectedEntries} Zeiteinträge in {billings.length} Projekt(en)
                      {summary.nonChargeableHours > 0 &&
                        ` · ${formatHours(summary.nonChargeableHours)} Std nicht fakturierbar`}
                    </p>
                  </div>

                  {summary.missingRateCards.length > 0 && (
                    <div className="bundle-warning">
                      ⚠️ Keine Rate Card für: <strong>{summary.missingRateCards.join(', ')}</strong>
                      {' '}— diese Stunden gehen mit 0 € in den Umsatz ein.
                    </div>
                  )}

                  {billings.length > 0 && (
                    <div className="bundle-section">
                      <h3>Projekte</h3>
                      <div className="bundle-table-wrapper">
                        <table className="bundle-table">
                          <thead>
                            <tr>
                              <th>Projekt</th>
                              <th>PO</th>
                              <th className="text-right">Stunden</th>
                              <th className="text-right">Tage</th>
                              <th className="text-right">Blended Rate</th>
                              <th className="text-right">Umsatz</th>
                            </tr>
                          </thead>
                          <tbody>
                            {billings.map(billing => (
                              <tr key={billing.projectName}>
                                <td>{billing.projectName}</td>
                                <td>
                                  {billing.purchaseOrder ?? (
                                    <span className="bundle-missing">fehlt</span>
                                  )}
                                </td>
                                <td className="text-right">{formatHours(billing.hours)}</td>
                                <td className="text-right">{formatDays(billing.days)}</td>
                                <td className="text-right">{currency(billing.blendedRate)}</td>
                                <td className="text-right">
                                  <strong>{currency(billing.betrag)}</strong>
                                </td>
                              </tr>
                            ))}
                            <tr className="bundle-total-row">
                              <td colSpan={2}>Gesamt</td>
                              <td className="text-right">{formatHours(summary.hours)}</td>
                              <td className="text-right">{formatDays(summary.days)}</td>
                              <td className="text-right">{currency(summary.blendedRate)}</td>
                              <td className="text-right">{currency(summary.betrag)}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  {summary.byRole.length > 0 && (
                    <div className="bundle-section">
                      <h3>Abrechnung nach Rolle</h3>
                      <div className="bundle-table-wrapper">
                        <table className="bundle-table">
                          <thead>
                            <tr>
                              <th>Rolle</th>
                              <th className="text-right">Stunden</th>
                              <th className="text-right">Tage</th>
                              <th className="text-right">Umsatz</th>
                              <th className="text-right">Anteil</th>
                            </tr>
                          </thead>
                          <tbody>
                            {summary.byRole.map(role => (
                              <tr key={role.roleLabel}>
                                <td>{role.roleLabel}</td>
                                <td className="text-right">{formatHours(role.hours)}</td>
                                <td className="text-right">{formatDays(role.days)}</td>
                                <td className="text-right">
                                  <strong>{currency(role.betrag)}</strong>
                                </td>
                                <td className="text-right">
                                  {summary.betrag > 0
                                    ? `${((role.betrag / summary.betrag) * 100).toFixed(1)} %`
                                    : '—'}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}

                  <div className="bundle-actions">
                    <button className="bundle-button-pdf" onClick={handleExportPDF}>
                      📄 Als PDF exportieren
                    </button>
                  </div>
                </>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}
