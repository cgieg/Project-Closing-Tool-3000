import type { ProjectState } from '../types'
import { canLockSnapshot, startCorrection } from '../lib/revisions'
import { lockSnapshotWithDocument } from '../lib/leistungsnachweisPdf'
import { appendAuditLog } from '../lib/auditLog'
import '../styles/ProjectList.css'

interface ProjectListProps {
  state: ProjectState
  onStateUpdate: (state: ProjectState) => void
  onSelectSnapshot: (snapshotId: string) => void
}

export function ProjectList({ state, onStateUpdate, onSelectSnapshot }: ProjectListProps) {

  /**
   * Schliesst direkt aus der Kartenansicht ab.
   *
   * Muss denselben Weg nehmen wie ProjectDetail - sonst liesse sich die
   * Rollenpruefung und die Belegablage ueber diese Karte umgehen.
   */
  const handleLock = (snapshotId: string) => {
    const snapshot = state.snapshots.find(s => s.id === snapshotId)
    if (!snapshot) return

    const check = canLockSnapshot(state, snapshot)
    if (!check.ok) {
      alert(
        `Abschluss blockiert - ${check.unresolved.length} Zuordnung(en) ohne Rolle:\n` +
          check.unresolved.map(u => `${u.employeeName} (${u.projectName})`).join('\n') +
          '\n\nIm Reiter "Projekt-Rollen" zuordnen.',
      )
      return
    }

    onStateUpdate(lockSnapshotWithDocument(state, snapshotId))
  }

  /**
   * Oeffnet eine abgeschlossene Abrechnung zur Korrektur.
   *
   * Bewusst kein direktes Entsperren: eine eingefrorene Fassung bleibt stehen,
   * es beginnt eine neue Version - ohne Begruendung passiert nichts. Dieselbe
   * Regel wie in ProjectDetail (revisions.startCorrection).
   */
  const handleUnlockForEdit = (snapshotId: string) => {
    const reason = window.prompt('Begründung für die Korrektur (erscheint im Verlauf):')?.trim()
    if (!reason) return

    const snapshot = state.snapshots.find(s => s.id === snapshotId)
    const withCorrection = startCorrection(state, snapshotId, reason)

    onStateUpdate(
      appendAuditLog(withCorrection, 'freigabe', `Korrektur begonnen: ${reason}`, {
        bundleId: snapshot?.bundleId,
        snapshotId,
      }),
    )
    onSelectSnapshot(snapshotId)
  }

  const handleToggleChargeability = (snapshotId: string) => {
    const snapshot = state.snapshots.find(s => s.id === snapshotId)
    if (!snapshot) return
    const allChargeable = snapshot.timeEntries.every(e => e.chargeable)

    const updatedSnapshots = state.snapshots.map(snap => {
      if (snap.id === snapshotId) {
        return {
          ...snap,
          timeEntries: snap.timeEntries.map(e => ({
            ...e,
            chargeable: !allChargeable,
          })),
          lastModifiedAt: new Date(),
        }
      }
      return snap
    })

    onStateUpdate(
      appendAuditLog(
        { ...state, snapshots: updatedSnapshots },
        'change',
        `Alle Zeiteinträge auf ${allChargeable ? 'nicht abrechenbar' : 'abrechenbar'} gesetzt`,
        { bundleId: snapshot.bundleId, snapshotId },
      ),
    )
  }

  return (
    <section className="project-list">
      <div className="project-list-header">
        <h2>Abrechnungen</h2>
        <p className="project-list-subtitle">Erstellt automatisch beim Zeiterfassungs-Import</p>
      </div>

      {state.snapshots.length === 0 ? (
        <div className="project-list-empty">
          <p>📥 Laden Sie eine Excel-Datei hoch, um Abrechnungen zu erstellen.</p>
        </div>
      ) : (
        <div className="project-list-grid">
          {state.snapshots.map(snapshot => (
            <div key={snapshot.id} className={`project-list-card ${snapshot.locked ? 'locked' : 'draft'}`}>
              <div className="project-list-card-header">
                <h3>{snapshot.month}</h3>
                <div className="project-list-badge-group">
                  <span className="project-list-version">v{snapshot.version}</span>
                  <span className={`project-list-status ${snapshot.locked ? 'locked' : 'draft'}`}>
                    {!snapshot.locked
                      ? '✏️ Entwurf'
                      : (snapshot.revisions ?? []).length > 1
                        ? '🔒 Korrigiert'
                        : '🔒 Freigegeben'}
                  </span>
                  {snapshot.documentNumber && (
                    <span className="project-list-docnumber" title="Belegnummer">
                      {snapshot.documentNumber}
                    </span>
                  )}
                </div>
              </div>

              <div className="project-list-card-info">
                <div className="project-list-info-item">
                  <span className="project-list-label">Zeiteinträge:</span>
                  <span className="project-list-value">{snapshot.timeEntries.length}</span>
                </div>
                <div className="project-list-info-item">
                  <span className="project-list-label">Mitarbeiter:</span>
                  <span className="project-list-value">{snapshot.employees.length}</span>
                </div>
                <div className="project-list-info-item">
                  <span className="project-list-label">Erstellt:</span>
                  <span className="project-list-value">{new Date(snapshot.createdAt).toLocaleDateString('de-DE')}</span>
                </div>
                {snapshot.lastModifiedBy && (
                  <div className="project-list-info-item">
                    <span className="project-list-label">Zuletzt geändert:</span>
                    <span className="project-list-value">
                      {new Date(snapshot.lastModifiedAt).toLocaleDateString('de-DE')} ({snapshot.lastModifiedBy})
                    </span>
                  </div>
                )}
                {snapshot.changelog && (
                  <div className="project-list-changelog">
                    <span className="project-list-label">Änderung:</span>
                    <p>{snapshot.changelog}</p>
                  </div>
                )}
              </div>

              <div className="project-list-card-actions">
                <button
                  className="project-list-button-secondary"
                  onClick={() => handleToggleChargeability(snapshot.id)}
                  title={snapshot.timeEntries.every(e => e.chargeable) ? 'Alle als nicht abrechenbar' : 'Alle als abrechenbar'}
                  style={{ fontSize: '12px', flex: '0 1 auto' }}
                >
                  {snapshot.timeEntries.every(e => e.chargeable) ? '✅ Abrechenbar' : '❌ Nicht abrechenbar'}
                </button>
                {snapshot.locked ? (
                  <>
                    <button
                      className="project-list-button-secondary"
                      onClick={() => handleUnlockForEdit(snapshot.id)}
                      title="Entsperren zum Bearbeiten"
                    >
                      🔓 Bearbeiten
                    </button>
                    <button
                      className="project-list-button-secondary"
                      onClick={() => onSelectSnapshot(snapshot.id)}
                      title="Anzeigen und exportieren"
                    >
                      👁️ Anzeigen
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="project-list-button-primary"
                      onClick={() => onSelectSnapshot(snapshot.id)}
                      title="Öffnen und bearbeiten"
                    >
                      ✏️ Öffnen
                    </button>
                    <button
                      className="project-list-button-success"
                      onClick={() => handleLock(snapshot.id)}
                      title="Abrechnung abschließen"
                    >
                      🔒 Abschließen
                    </button>
                  </>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  )
}
