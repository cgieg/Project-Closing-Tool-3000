import { useState } from 'react'
import type { ProjectState } from '../types'
import { summarizeNonChargeable } from '../lib/billingAggregation'
import { amountFromDays, daysFromHours, formatDays, formatHours, roundHours } from '../lib/rounding'
import {
  buildPdfForRevision,
  buildPdfForSnapshot,
  downloadStoredPdf,
  leistungsnachweisFileName,
  lockSnapshotWithDocument,
  revisionFileName,
} from '../lib/leistungsnachweisPdf'
import { canLockSnapshot, diffRevisions, revisionsOf, startCorrection } from '../lib/revisions'
import {
  findProjectByName,
  findRateCard,
  isEntryBillable,
  resolveEffectiveRole,
} from '../lib/roleResolution'
import { appendAuditLog } from '../lib/auditLog'
import '../styles/ProjectDetail.css'

interface ProjectDetailProps {
  state: ProjectState
  snapshotId: string
  onStateUpdate: (state: ProjectState) => void
  onBack: () => void
  onNavigateToRoles?: () => void
}

interface CostLine {
  funktion: string
  level: string
  standort: string
  hours: number
  days: string
  tagessatz: number
  cost: string
  fromProjectAssignment: boolean
  hasRateCard: boolean
}

const euro = (v: number) =>
  `${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

/** Mit Vorzeichen - eine Korrektur ohne Richtung waere unbrauchbar. */
const withSign = (v: number, format: (n: number) => string) =>
  v === 0 ? format(0) : v > 0 ? `+${format(v)}` : `-${format(Math.abs(v))}`

const signedEuro = (v: number) => withSign(v, euro)
const signedHours = (v: number) => withSign(v, formatHours)
const signedDays = (v: number) => withSign(v, formatDays)

export function ProjectDetail({ state, snapshotId, onStateUpdate, onBack, onNavigateToRoles }: ProjectDetailProps) {
  const [showCorrection, setShowCorrection] = useState(false)
  const [correctionReason, setCorrectionReason] = useState('')

  const calculateCosts = (
    timeEntries: any[],
    employees: any[],
    rateCards: any[],
    project: { fakturierbar?: boolean } | undefined,
  ) => {
    // Erst je Mitarbeiter summieren - die Excel-Vorgabe rundet auf Personenebene
    // (Gesamtstunden je Ressource), nicht je Zeiteintrag und nicht erst nach dem
    // Zusammenfassen mehrerer Personen zur selben Rolle - siehe lib/rounding.ts.
    const resourceMap = new Map<
      string,
      { hours: number; role: any; fromProjectAssignment: boolean; date?: Date }
    >()
    const missingEmployees = new Set<string>()

    timeEntries
      .filter((e: any) => isEntryBillable(e, project))
      .forEach((entry: any) => {
        const emp = employees.find((e: any) => e.name === entry.resource)
        if (!emp) {
          missingEmployees.add(entry.resource)
          return
        }

        const effectiveRole = resolveEffectiveRole(
          emp,
          entry.projectName,
          state.projects,
          state.projectAssignments || []
        )

        const current = resourceMap.get(entry.resource) || {
          hours: 0,
          role: effectiveRole,
          fromProjectAssignment: effectiveRole.fromProjectAssignment,
          date: entry.date ? new Date(entry.date) : undefined,
        }
        current.hours += entry.effort ?? entry.effortHours ?? 0
        resourceMap.set(entry.resource, current)
      })

    // Nach effektiver Rolle gruppieren - je Mitarbeiter bereits gerundet.
    const roleMap = new Map<
      string,
      { hours: number; days: number; role: any; fromProjectAssignment: boolean; date?: Date }
    >()
    resourceMap.forEach(({ hours, role, fromProjectAssignment, date }) => {
      const roleKey = `${role.funktion}|${role.level}|${role.standort}`
      const hoursRounded = roundHours(hours)
      const days = daysFromHours(hoursRounded)
      const current = roleMap.get(roleKey) || {
        hours: 0,
        days: 0,
        role,
        fromProjectAssignment,
        date,
      }
      current.hours += hoursRounded
      current.days += days
      roleMap.set(roleKey, current)
    })

    const costs: CostLine[] = []
    let totalCost = 0
    const missingRateCards: string[] = []

    roleMap.forEach(data => {
      const rateCard = findRateCard(data.role, rateCards, data.date)

      const hoursRounded = data.hours
      const days = data.days
      const cost = rateCard ? amountFromDays(days, rateCard.tagessatz) : 0
      totalCost += cost

      if (!rateCard) {
        missingRateCards.push(`${data.role.level} ${data.role.funktion} (${data.role.standort})`)
      }

      costs.push({
        funktion: data.role.funktion,
        level: data.role.level,
        standort: data.role.standort,
        hours: hoursRounded,
        days: formatDays(days),
        tagessatz: rateCard?.tagessatz || 0,
        cost: cost.toFixed(2),
        fromProjectAssignment: data.fromProjectAssignment,
        hasRateCard: Boolean(rateCard),
      })
    })

    costs.sort((a, b) => Number(b.cost) - Number(a.cost))

    return {
      costs,
      totalCost: totalCost.toFixed(2),
      missingRateCards,
      missingEmployees: Array.from(missingEmployees),
    }
  }

  const snapshot = state.snapshots.find(s => s.id === snapshotId)

  if (!snapshot) {
    return (
      <section className="project-detail">
        <div className="project-detail-error">
          <h2>Abrechnung nicht gefunden</h2>
          <button onClick={onBack}>← Zurück</button>
        </div>
      </section>
    )
  }

  // Ein Snapshot gehoert zu genau einem Projekt (siehe createProjectSnapshots beim Import).
  // Der Projektname aus den Zeiteintraegen fuehrt zum Projekt und damit zur PO-Nummer.
  const revisions = revisionsOf(snapshot)
  const snapshotProjectName = snapshot.timeEntries[0]?.projectName || ''
  const snapshotProject = findProjectByName(snapshotProjectName, state.projects)
  const purchaseOrder = snapshotProject?.purchaseOrder
  const lockCheck = canLockSnapshot(state, snapshot)
  const belegStatus = snapshot.locked ? (revisions.length > 1 ? 'Korrigiert' : 'Freigegeben') : 'Entwurf'

  /**
   * Schliesst ab, friert die Fassung ein und legt den erzeugten Beleg unveraendert
   * ab. Blockiert, solange eine Rolle sich nicht auflösen lässt - siehe
   * roleResolution.unresolvedChargeableAssignments.
   */
  const handleLock = () => {
    if (!lockCheck.ok) return
    onStateUpdate(lockSnapshotWithDocument(state, snapshotId))
  }

  /**
   * Oeffnet eine abgeschlossene Abrechnung fuer eine Korrektur.
   * Die bisherige Fassung bleibt erhalten - ohne Begruendung passiert nichts.
   */
  const handleStartCorrection = () => {
    const reason = correctionReason.trim()
    if (!reason) return
    const withCorrection = startCorrection(state, snapshotId, reason)
    onStateUpdate(
      appendAuditLog(withCorrection, 'freigabe', `Korrektur begonnen: ${reason}`, {
        bundleId: snapshot.bundleId,
        snapshotId,
      }),
    )
    setCorrectionReason('')
    setShowCorrection(false)
  }

  const handleExportRevision = (version: number) => {
    const revision = revisions.find(r => r.version === version)
    if (!revision) return

    // Der bei der Freigabe abgelegte Beleg ist der massgebliche - nicht eine
    // Neuberechnung. Nur aeltere Fassungen ohne Ablage werden noch rekonstruiert.
    if (revision.pdfBase64 && revision.pdfFileName) {
      downloadStoredPdf(revision.pdfBase64, revision.pdfFileName)
    } else {
      // Die Vorfassung mitgeben - daraus entsteht der Korrekturabschnitt im Beleg
      const previous = revisions.find(r => r.version === version - 1)
      buildPdfForRevision(revision, previous).save(revisionFileName(revision))
    }

    onStateUpdate(
      appendAuditLog(state, 'export', `Leistungsnachweis ${revision.documentNumber} exportiert (Fassung ${revision.version})`, {
        bundleId: snapshot.bundleId,
        snapshotId,
      }),
    )
  }

  /**
   * Setzt die WBS-Regel nachtraeglich auf eine bereits importierte Abrechnung an.
   *
   * Fruehere Importe haben jede Zeile als abrechenbar markiert, auch Projektmanagement
   * und Overhead. Das ruecksichtslos beim Laden zu korrigieren waere heikel - es
   * aendert Rechnungsbetraege. Deshalb als bewusste Aktion.
   */
  const handleApplyWbsRule = () => {
    const affected = snapshot.timeEntries.filter(e => e.chargeable && !e.isProductive)
    if (affected.length === 0) return

    const hours = affected.reduce((sum, e) => sum + (e.effort ?? e.effortHours ?? 0), 0)
    if (
      !confirm(
        `${affected.length} nicht fakturierbare Zeile(n) mit ${formatHours(hours)} Stunden ` +
          'werden auf "nicht abrechenbar" gesetzt. Der Rechnungsbetrag sinkt entsprechend.\n\n' +
          'Fortfahren?'
      )
    )
      return

    const updatedSnapshots = state.snapshots.map(snap =>
      snap.id === snapshotId
        ? {
            ...snap,
            timeEntries: snap.timeEntries.map(e =>
              e.chargeable && !e.isProductive ? { ...e, chargeable: false } : e
            ),
            lastModifiedAt: new Date(),
          }
        : snap
    )
    onStateUpdate(
      appendAuditLog(
        { ...state, snapshots: updatedSnapshots },
        'change',
        `WBS-Regel angewendet: ${affected.length} Zeile(n) auf nicht abrechenbar gesetzt`,
        { detail: `${formatHours(hours)} Std`, bundleId: snapshot.bundleId, snapshotId },
      ),
    )
  }

  const handleExportPDF = () => {
    // Ist die Abrechnung abgeschlossen, gilt die eingefrorene Fassung - samt
    // Korrekturabschnitt. Den Arbeitsstand neu zu rechnen wuerde einen Beleg
    // erzeugen, der von dem abweicht, was tatsaechlich gestellt wurde.
    const latest = revisions[0]
    if (snapshot.locked && latest) {
      handleExportRevision(latest.version)
      return
    }

    buildPdfForSnapshot(state, snapshot).save(leistungsnachweisFileName(snapshot, snapshotProject))
    onStateUpdate(
      appendAuditLog(state, 'export', `Leistungsnachweis (Entwurf) exportiert: ${snapshotProjectName}`, {
        bundleId: snapshot.bundleId,
        snapshotId,
      }),
    )
  }

  return (
    <section className="project-detail">
      <div className="project-detail-header">
        <button className="project-detail-back" onClick={onBack}>
          ← Zurück
        </button>
        <div className="project-detail-title">
          <h2>{snapshot.month}</h2>
          <div className="project-detail-badges">
            <span className="project-detail-version">v{snapshot.version}</span>
            <span className={`project-detail-status ${snapshot.locked ? 'locked' : 'draft'}`}>
              {belegStatus === 'Entwurf' ? '✏️ Entwurf' : belegStatus === 'Korrigiert' ? '🔒 Korrigiert' : '🔒 Freigegeben'}
            </span>
            {snapshot.documentNumber && (
              <span className="project-detail-docnumber" title="Belegnummer des Leistungsnachweises">
                {snapshot.documentNumber}
              </span>
            )}
            {purchaseOrder ? (
              <span className="project-detail-po">PO: {purchaseOrder}</span>
            ) : snapshotProject ? (
              <span className="project-detail-po missing" title="PO unter Daten → Projekte verwalten hinterlegen">
                PO fehlt
              </span>
            ) : null}
          </div>
        </div>
        <div className="project-detail-actions-header">
          {snapshot.locked ? (
            <button
              className="project-detail-button-secondary"
              onClick={() => setShowCorrection(true)}
            >
              ✎ Korrektur anlegen
            </button>
          ) : (
            <button
              className="project-detail-button-success"
              onClick={handleLock}
              disabled={!lockCheck.ok}
              title={lockCheck.ok ? undefined : 'Offene Rollenzuordnungen blockieren den Abschluss'}
            >
              🔒 Abschließen
            </button>
          )}
        </div>
      </div>

      {!lockCheck.ok && (
        <div className="project-detail-warning" style={{ margin: '0 0 16px' }}>
          <strong>⚠️ {lockCheck.unresolved.length} Zuordnung(en) ohne Rolle</strong> blockieren den
          Abschluss:{' '}
          {lockCheck.unresolved.map(u => `${u.employeeName} (${formatHours(u.hours)} Std)`).join(', ')}.{' '}
          {onNavigateToRoles ? (
            <button className="project-detail-inline-action" onClick={onNavigateToRoles}>
              Jetzt zuordnen
            </button>
          ) : (
            'Im Reiter „Projekt-Rollen" zuordnen.'
          )}
        </div>
      )}

      <div className="project-detail-content">
        <div className="project-detail-section">
          <h3>Übersicht</h3>
          <div className="project-detail-overview">
            <div className="project-detail-overview-item">
              <span className="label">Zeiteinträge:</span>
              <span className="value">{snapshot.timeEntries.length}</span>
            </div>
            <div className="project-detail-overview-item">
              <span className="label">Mitarbeiter:</span>
              <span className="value">{snapshot.employees.length}</span>
            </div>
            <div className="project-detail-overview-item">
              <span className="label">Erstellt:</span>
              <span className="value">{new Date(snapshot.createdAt).toLocaleDateString('de-DE')}</span>
            </div>
            {snapshot.lastModifiedBy && (
              <div className="project-detail-overview-item">
                <span className="label">Zuletzt geändert:</span>
                <span className="value">
                  {new Date(snapshot.lastModifiedAt).toLocaleDateString('de-DE')} ({snapshot.lastModifiedBy})
                </span>
              </div>
            )}
          </div>
        </div>

        {snapshot.timeEntries.length === 0 ? null : state.rateCards.length === 0 ? (
          <div className="project-detail-section">
            <h3>💰 Abrechnung pro Rolle</h3>
            <div className="project-detail-warning">
              Keine Rate Cards hinterlegt. Unter <strong>Rate Cards</strong> die Vorlage
              herunterladen, ausfüllen und importieren - danach wird hier gerechnet.
            </div>
          </div>
        ) : (() => {
          const { costs, totalCost, missingRateCards, missingEmployees } = calculateCosts(
            snapshot.timeEntries,
            snapshot.employees,
            state.rateCards,
            snapshotProject
          )
          const chargeableEntries = snapshot.timeEntries.filter(e => isEntryBillable(e, snapshotProject))

          return chargeableEntries.length > 0 ? (
            <div className="project-detail-section">
              <h3>💰 Abrechnung pro Rolle</h3>

              {missingRateCards.length > 0 && (
                <div className="project-detail-warning">
                  ⚠️ Keine Rate Card für: <strong>{missingRateCards.join(', ')}</strong> - diese
                  Zeilen werden mit 0 € gerechnet.
                </div>
              )}

              {missingEmployees.length > 0 && (
                <div className="project-detail-warning">
                  ⚠️ Nicht zugeordnete Mitarbeiter: <strong>{missingEmployees.join(', ')}</strong>
                </div>
              )}

              <div className="project-detail-table-wrapper">
                <table className="project-detail-table">
                  <thead>
                    <tr>
                      <th>Funktion</th>
                      <th>Level</th>
                      <th>Standort</th>
                      <th className="text-right">Stunden</th>
                      <th className="text-right">Tage (÷8)</th>
                      <th className="text-right">€ Tagessatz</th>
                      <th className="text-right">€ Ergebnis</th>
                    </tr>
                  </thead>
                  <tbody>
                    {costs.map((cost, idx) => (
                      <tr key={idx} className={cost.hasRateCard ? undefined : 'row-missing-rate'}>
                        <td>
                          {cost.funktion}
                          {!cost.fromProjectAssignment && (
                            <span className="project-detail-role-tag project-detail-role-tag-open" title="Ohne Projekt-Rollen-Zuordnung">
                              Rolle offen
                            </span>
                          )}
                        </td>
                        <td>{cost.level}</td>
                        <td>{cost.standort}</td>
                        <td className="text-right"><strong>{formatHours(Number(cost.hours))}</strong></td>
                        <td className="text-right"><strong>{cost.days}</strong></td>
                        <td className="text-right">
                          {cost.hasRateCard ? `€ ${cost.tagessatz.toFixed(2)}` : '—'}
                        </td>
                        <td className="text-right"><strong>€ {cost.cost}</strong></td>
                      </tr>
                    ))}
                    <tr style={{ borderTop: '2px solid var(--brand-navy)', fontWeight: 600, backgroundColor: 'var(--brand-light-gray)' }}>
                      <td colSpan={3}>Gesamtumsatz:</td>
                      <td className="text-right" style={{ borderRight: '1px solid var(--brand-medium-gray)' }}></td>
                      <td colSpan={2} style={{ textAlign: 'right' }}></td>
                      <td style={{ textAlign: 'right' }}>€ {totalCost}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </div>
          ) : null
        })()}

        {(() => {
          const nonChargeable = summarizeNonChargeable(snapshot.timeEntries, snapshotProject)
          const wrongly = snapshot.timeEntries.filter(e => e.chargeable && !e.isProductive)
          const wronglyHours = wrongly.reduce((s, e) => s + (e.effort ?? e.effortHours ?? 0), 0)

          if (nonChargeable.hours === 0 && wrongly.length === 0) return null

          return (
            <div className="project-detail-section">
              <h3>📋 Nicht berechnete Zeiten</h3>

              {wrongly.length > 0 && (
                <div className="project-detail-warning">
                  <strong>{wrongly.length} nicht fakturierbare Zeile(n)</strong> mit{' '}
                  {formatHours(wronglyHours)} Stunden sind als abrechenbar markiert und gehen
                  derzeit in den Rechnungsbetrag ein. Seit der Umstellung setzt der Import WBS
                  1.x automatisch auf nicht abrechenbar — diese Abrechnung stammt noch von davor.
                  {!snapshot.locked && (
                    <button className="project-detail-inline-action" onClick={handleApplyWbsRule}>
                      Regel jetzt anwenden
                    </button>
                  )}
                </div>
              )}

              {nonChargeable.hours > 0 ? (
                <>
                  <div className="project-detail-table-wrapper">
                    <table className="project-detail-table">
                      <thead>
                        <tr>
                          <th>Tätigkeit</th>
                          <th className="text-right">Stunden</th>
                          <th className="text-right">Tage (÷8)</th>
                        </tr>
                      </thead>
                      <tbody>
                        {nonChargeable.byTaskType.map(row => (
                          <tr key={row.taskType}>
                            <td>{row.taskType}</td>
                            <td className="text-right">{formatHours(row.hours)}</td>
                            <td className="text-right">{formatDays(daysFromHours(row.hours))}</td>
                          </tr>
                        ))}
                        <tr className="project-detail-total-row">
                          <td>Summe</td>
                          <td className="text-right">{formatHours(nonChargeable.hours)}</td>
                          <td className="text-right">{formatDays(daysFromHours(nonChargeable.hours))}</td>
                        </tr>
                      </tbody>
                    </table>
                  </div>
                  <p className="project-detail-hint">
                    Diese Stunden belegen geleistete Arbeit, erzeugen aber keinen Rechnungsbetrag.
                  </p>
                </>
              ) : null}
            </div>
          )
        })()}

        {(revisions.length > 0 || snapshot.correctionReason || snapshot.locked) && (
          <div className="project-detail-section">
            <h3>🗂 Verlauf</h3>

            {snapshot.correctionReason && !snapshot.locked && (
              <div className="project-detail-current-correction">
                <span className="pd-rev-badge current">Fassung {snapshot.version}</span>
                <div>
                  <strong>In Bearbeitung</strong>
                  <p>{snapshot.correctionReason}</p>
                </div>
              </div>
            )}

            {revisions.length === 0 ? (
              <p className="project-detail-hint">
                Noch keine abgeschlossene Fassung. Beim Abschließen wird der Stand
                unveränderlich festgehalten und lässt sich später gegen Korrekturen
                vergleichen.
              </p>
            ) : (
              <div className="pd-revisions">
                {revisions.map(revision => {
                  const older = revisions.find(r => r.version === revision.version - 1)
                  const diff = older ? diffRevisions(older, revision) : null

                  return (
                    <div key={revision.version} className="pd-revision">
                      <div className="pd-revision-head">
                        <span className="pd-rev-badge">Fassung {revision.version}</span>
                        <span className="pd-rev-date">
                          {new Date(revision.frozenAt).toLocaleDateString('de-DE')}
                        </span>
                        <span className="pd-rev-betrag">
                          {revision.totalBetrag.toLocaleString('de-DE', {
                            minimumFractionDigits: 2,
                            maximumFractionDigits: 2,
                          })}{' '}
                          €
                        </span>
                        {diff && diff.betragDelta !== 0 && (
                          <span
                            className={`pd-rev-delta ${diff.betragDelta < 0 ? 'minus' : 'plus'}`}
                          >
                            {diff.betragDelta > 0 ? '+' : ''}
                            {diff.betragDelta.toLocaleString('de-DE', {
                              minimumFractionDigits: 2,
                              maximumFractionDigits: 2,
                            })}{' '}
                            €
                          </span>
                        )}
                        <button
                          className="pd-rev-print"
                          onClick={() => handleExportRevision(revision.version)}
                          title={`Fassung ${revision.version} als PDF`}
                        >
                          📄 Als PDF
                        </button>
                      </div>

                      <p className="pd-revision-reason">{revision.reason}</p>

                      {diff && diff.byRole.length > 0 && (
                        <div className="pd-correction">
                          <div className="pd-correction-title">
                            Rechnungskorrektur gegenüber Fassung {revision.version - 1}
                          </div>
                          <div className="project-detail-table-wrapper">
                            <table className="project-detail-table pd-correction-table">
                              <thead>
                                <tr>
                                  <th>Funktion</th>
                                  <th>Level</th>
                                  <th>Standort</th>
                                  <th className="text-right">Stunden</th>
                                  <th className="text-right">Tage</th>
                                  <th className="text-right">Tagessatz</th>
                                  <th className="text-right">Betrag</th>
                                </tr>
                              </thead>
                              <tbody>
                                {diff.byRole.map(line => (
                                  <tr key={`${line.roleLabel}-${line.tagessatz}`}>
                                    <td>{line.funktion}</td>
                                    <td>{line.level}</td>
                                    <td>{line.standort}</td>
                                    <td className="text-right">
                                      {signedHours(line.hoursDelta)}
                                    </td>
                                    <td className="text-right">{signedDays(line.daysDelta)}</td>
                                    <td className="text-right">{euro(line.tagessatz)}</td>
                                    <td
                                      className={`text-right ${line.betragDelta < 0 ? 'pd-minus' : 'pd-plus'}`}
                                    >
                                      <strong>{signedEuro(line.betragDelta)}</strong>
                                    </td>
                                  </tr>
                                ))}
                                <tr className="project-detail-total-row">
                                  <td colSpan={6}>Korrekturbetrag</td>
                                  <td
                                    className={`text-right ${diff.betragDelta < 0 ? 'pd-minus' : 'pd-plus'}`}
                                  >
                                    {signedEuro(diff.betragDelta)}
                                  </td>
                                </tr>
                              </tbody>
                            </table>
                          </div>
                        </div>
                      )}

                      {!older && revisions.length === 1 && (
                        <p className="project-detail-hint">
                          Erste Fassung. Eine Korrektur legt eine zweite an und weist die
                          Differenz je Rolle aus.
                        </p>
                      )}

                      {diff?.unchanged && (
                        <p className="project-detail-hint">
                          Keine inhaltliche Änderung gegenüber der Vorfassung.
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {snapshot.timeEntries.length > 0 && (
          <div className="project-detail-section">
            <h3>Zeiteinträge ({snapshot.timeEntries.length})</h3>
            {!snapshot.locked && (
              <p className="project-detail-hint">💡 Klick auf "Abrechenbar" zum Umschalten (nicht abrechenbare Einträge)</p>
            )}
            <div className="project-detail-table-wrapper">
              <table className="project-detail-table">
                <thead>
                  <tr>
                    <th>Projekt</th>
                    <th>WBS</th>
                    <th>Ressource</th>
                    <th>Datum</th>
                    <th className="text-right">Stunden</th>
                    <th>Typ</th>
                    <th style={{ textAlign: 'center' }}>Abrechenbar</th>
                    <th>Abgerechnet in</th>
                  </tr>
                </thead>
                <tbody>
                  {[...snapshot.timeEntries]
                    .sort((a, b) => {
                      // First sort by resource (employee)
                      const resourceSort = a.resource.localeCompare(b.resource, 'de')
                      if (resourceSort !== 0) return resourceSort
                      // Then sort by date
                      return new Date(a.date).getTime() - new Date(b.date).getTime()
                    })
                    .map((entry, idx) => {
                      // Rückwärts-Drilldown: in welcher Fassung dieses Snapshots
                      // wurde der Eintrag zuletzt abgerechnet - revisions ist
                      // bereits neueste zuerst sortiert (revisionsOf).
                      const identity = entry.timeId ?? entry.id
                      const billedIn = revisions.find(rev =>
                        rev.timeEntries.some(e => (e.timeId ?? e.id) === identity && e.chargeable),
                      )

                      return (
                    <tr key={idx}>
                      <td>{entry.projectName}</td>
                      <td>{entry.wbsCode}</td>
                      <td>{entry.resource}</td>
                      <td>{new Date(entry.date).toLocaleDateString('de-DE')}</td>
                      <td className="text-right">{formatHours(roundHours(entry.effort))}</td>
                      <td>{entry.taskType}</td>
                      <td style={{ textAlign: 'center' }}>
                        {snapshot.locked ? (
                          <span>{entry.chargeable ? '✅' : '❌'}</span>
                        ) : (
                          <button
                            className="project-detail-chargeable-toggle"
                            onClick={() => {
                              const entryIndex = snapshot.timeEntries.indexOf(entry)
                              if (entryIndex === -1) return
                              const updated = snapshot.timeEntries.map((e, i) =>
                                i === entryIndex ? { ...e, chargeable: !e.chargeable } : e
                              )
                              const updatedSnapshots = state.snapshots.map(s =>
                                s.id === snapshotId ? { ...s, timeEntries: updated } : s
                              )
                              onStateUpdate(
                                appendAuditLog(
                                  { ...state, snapshots: updatedSnapshots },
                                  'change',
                                  `Abrechenbar-Kennzeichnung geändert: ${entry.resource}, ${new Date(entry.date).toLocaleDateString('de-DE')} → ${!entry.chargeable ? 'abrechenbar' : 'nicht abrechenbar'}`,
                                  { bundleId: snapshot.bundleId, snapshotId },
                                ),
                              )
                            }}
                            title={entry.chargeable ? 'Klick: nicht abrechenbar' : 'Klick: abrechenbar'}
                          >
                            {entry.chargeable ? '✅' : '❌'}
                          </button>
                        )}
                      </td>
                      <td className="project-detail-hint">
                        {billedIn
                          ? `${billedIn.documentNumber} · Fassung ${billedIn.version}`
                          : entry.chargeable
                            ? 'offen'
                            : '—'}
                      </td>
                    </tr>
                      )
                    })}
                </tbody>
              </table>
            </div>
          </div>
        )}



      </div>

      {showCorrection && (
        <div className="pd-modal-overlay" onClick={() => setShowCorrection(false)}>
          <div className="pd-modal" onClick={e => e.stopPropagation()}>
            <h3>Korrektur anlegen</h3>
            <p className="pd-modal-lead">
              Fassung {snapshot.version} bleibt unverändert erhalten und lässt sich weiterhin
              drucken. Es beginnt Fassung {snapshot.version + 1}.
            </p>

            <div className="pd-form-group">
              <label htmlFor="pd-reason">Begründung *</label>
              <textarea
                id="pd-reason"
                rows={3}
                value={correctionReason}
                onChange={e => setCorrectionReason(e.target.value)}
                placeholder="z.B. Rechnung 4711 moniert: PM-Stunden nicht vereinbart"
                autoFocus
              />
              <p className="project-detail-hint">
                Erscheint im Verlauf und macht die Korrektur später nachvollziehbar.
              </p>
            </div>

            <div className="pd-modal-actions">
              <button
                className="project-detail-button-secondary"
                onClick={() => setShowCorrection(false)}
              >
                Abbrechen
              </button>
              <button
                className="project-detail-button-success"
                onClick={handleStartCorrection}
                disabled={!correctionReason.trim()}
              >
                Korrektur beginnen
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="project-detail-footer">
        <button className="project-detail-button-secondary" onClick={onBack}>
          ← Zurück zur Liste
        </button>
        <button
          className="project-detail-button-secondary"
          onClick={handleExportPDF}
          title={
            snapshot.locked && revisions[0]
              ? `Fassung ${revisions[0].version} als PDF`
              : 'Aktuellen Arbeitsstand als PDF'
          }
        >
          {/* Bei abgeschlossener Abrechnung wird die eingefrorene Fassung
              gedruckt - die Beschriftung soll das sagen, nicht verschleiern. */}
          📄 {snapshot.locked && revisions[0]
            ? `Fassung ${revisions[0].version} als PDF`
            : 'Als PDF'}
        </button>
        {snapshot.locked ? (
          <button
            className="project-detail-button-secondary"
            onClick={() => setShowCorrection(true)}
          >
            ✎ Korrektur anlegen
          </button>
        ) : (
          <button className="project-detail-button-success" onClick={handleLock}>
            🔒 Abrechnung abschließen
          </button>
        )}
      </div>
    </section>
  )
}
