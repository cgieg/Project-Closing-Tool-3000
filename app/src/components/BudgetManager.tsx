import { Fragment, useMemo, useState } from 'react'
import type { PoRollenBudget, ProjectState, PurchaseOrder, RateCard } from '../types'
import {
  activePurchaseOrder,
  consumptionLinesFromRevision,
  consumptionTimeline,
  createPurchaseOrder,
  latestRevisionsForProject,
  poStichtagReport,
  projectBudgetOverview,
  purchaseOrdersOfProject,
  recordInitialConsumption,
  recordLeistungsnachweisConsumption,
  roleLabel,
  rolesOfProject,
  updatePurchaseOrder,
  type BudgetRole,
  type RevisionForMonth,
} from '../lib/budgetAggregation'
import { buildBudgetReportPdf, budgetReportFileName } from '../lib/budgetReportPdf'
import { appendAuditLog } from '../lib/auditLog'
import { getCurrentUser } from '../lib/currentUser'
import '../styles/BudgetManager.css'

interface BudgetManagerProps {
  state: ProjectState
  onStateUpdate: (state: ProjectState) => void
}

const currency = (v: number) =>
  `${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

const LEVELS: RateCard['level'][] = ['Expert', 'Senior', 'Intermediate', 'Junior']

function toInputDate(date?: Date): string {
  if (!date) return ''
  const d = new Date(date)
  if (Number.isNaN(d.getTime())) return ''
  return d.toISOString().slice(0, 10)
}

function fromInputDate(value: string): Date | undefined {
  if (!value) return undefined
  const d = new Date(`${value}T00:00:00`)
  return Number.isNaN(d.getTime()) ? undefined : d
}

interface RollenBudgetRow extends PoRollenBudget {
  key: string
}

interface PoFormState {
  poNummer: string
  laufzeitStart: string
  laufzeitEnde: string
  rollenBudgets: RollenBudgetRow[]
}

const emptyPoForm = (): PoFormState => ({
  poNummer: '',
  laufzeitStart: toInputDate(new Date()),
  laufzeitEnde: '',
  rollenBudgets: [],
})

export function BudgetManager({ state, onStateUpdate }: BudgetManagerProps) {
  const [selectedProjectId, setSelectedProjectId] = useState('')
  const [showPoForm, setShowPoForm] = useState(false)
  const [renewFromPoId, setRenewFromPoId] = useState<string | null>(null)
  const [editPoId, setEditPoId] = useState<string | null>(null)
  const [poForm, setPoForm] = useState<PoFormState>(emptyPoForm())
  const [stichtagInput, setStichtagInput] = useState('')
  const [expandedPoId, setExpandedPoId] = useState<string | null>(null)
  const [poStichtagInput, setPoStichtagInput] = useState('')
  const [editingInitialRole, setEditingInitialRole] = useState<BudgetRole | null>(null)
  const [initialForm, setInitialForm] = useState({ betrag: '', tage: '' })

  const project = state.projects.find(p => p.id === selectedProjectId)

  const roleOptions = useMemo(() => {
    const byKey = new Map<string, BudgetRole>()
    state.rateCards.forEach(rc =>
      byKey.set(`${rc.funktion}|${rc.level}|${rc.standort}`, {
        funktion: rc.funktion,
        level: rc.level,
        standort: rc.standort,
      }),
    )
    return Array.from(byKey.values()).sort(
      (a, b) =>
        a.funktion.localeCompare(b.funktion) ||
        LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level) ||
        a.standort.localeCompare(b.standort),
    )
  }, [state.rateCards])

  const pos = useMemo(() => (project ? purchaseOrdersOfProject(state, project.id) : []), [state, project])
  const active = project ? activePurchaseOrder(state, project.id) : undefined
  const stichtag = fromInputDate(stichtagInput)
  const overview = useMemo(
    () => (project ? projectBudgetOverview(state, project.id, stichtag) : undefined),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state, project, stichtagInput],
  )
  const timeline = useMemo(() => (project ? consumptionTimeline(state, project.id) : []), [state, project])
  const yearly = useMemo(() => {
    const byYear = new Map<string, number>()
    timeline.forEach(t => byYear.set(t.periode.slice(0, 4), (byYear.get(t.periode.slice(0, 4)) ?? 0) + t.betrag))
    return Array.from(byYear.entries()).sort((a, b) => a[0].localeCompare(b[0]))
  }, [timeline])
  const roles = useMemo(() => (project ? rolesOfProject(state, project.id) : []), [state, project])
  const openRevisions = useMemo(
    () => (project ? latestRevisionsForProject(state, project.id) : []),
    [state, project],
  )
  const recordedPeriods = useMemo(
    () =>
      new Set(
        (state.budgetConsumption ?? [])
          .filter(e => e.projectId === project?.id && e.typ === 'leistungsnachweis')
          .map(e => e.periode),
      ),
    [state.budgetConsumption, project],
  )

  const allProjectsReport = useMemo(
    () =>
      [...state.projects]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(p => ({
          project: p,
          active: activePurchaseOrder(state, p.id),
          overview: projectBudgetOverview(state, p.id),
        })),
    [state],
  )
  const allProjectsTotals = useMemo(() => {
    const gesamtBudget = allProjectsReport.reduce((sum, r) => sum + r.overview.gesamtBudget, 0)
    const gesamtVerbrauch = allProjectsReport.reduce((sum, r) => sum + r.overview.gesamtVerbrauch, 0)
    return {
      gesamtBudget,
      gesamtVerbrauch,
      gesamtRest: gesamtBudget - gesamtVerbrauch,
      prozent: gesamtBudget > 0 ? Math.round((gesamtVerbrauch / gesamtBudget) * 1000) / 10 : 0,
    }
  }, [allProjectsReport])

  const openNewPo = () => {
    setRenewFromPoId(null)
    setEditPoId(null)
    setPoForm(emptyPoForm())
    setShowPoForm(true)
  }

  const openRenewPo = (po: PurchaseOrder) => {
    setRenewFromPoId(po.id)
    setEditPoId(null)
    const nextStart = po.laufzeitEnde ? new Date(new Date(po.laufzeitEnde).getTime() + 86400000) : new Date()
    setPoForm({
      poNummer: '',
      laufzeitStart: toInputDate(nextStart),
      laufzeitEnde: '',
      rollenBudgets: po.rollenBudgets.map((rb, i) => ({ ...rb, betrag: 0, tage: undefined, key: `renew-${i}` })),
    })
    setShowPoForm(true)
  }

  const openEditPo = (po: PurchaseOrder) => {
    setEditPoId(po.id)
    setRenewFromPoId(null)
    setPoForm({
      poNummer: po.poNummer,
      laufzeitStart: toInputDate(po.laufzeitStart),
      laufzeitEnde: toInputDate(po.laufzeitEnde),
      rollenBudgets: po.rollenBudgets.map((rb, i) => ({ ...rb, key: `edit-${i}` })),
    })
    setShowPoForm(true)
  }

  const closePoForm = () => {
    setShowPoForm(false)
    setRenewFromPoId(null)
    setEditPoId(null)
  }

  const addRollenBudgetRow = () => {
    setPoForm(f => ({
      ...f,
      rollenBudgets: [
        ...f.rollenBudgets,
        {
          key: `${Date.now()}-${f.rollenBudgets.length}`,
          funktion: roleOptions[0]?.funktion ?? '',
          level: roleOptions[0]?.level ?? 'Senior',
          standort: roleOptions[0]?.standort ?? 'Deutschland',
          betrag: 0,
        },
      ],
    }))
  }

  const updateRollenBudgetRow = (key: string, patch: Partial<RollenBudgetRow>) => {
    setPoForm(f => ({ ...f, rollenBudgets: f.rollenBudgets.map(rb => (rb.key === key ? { ...rb, ...patch } : rb)) }))
  }

  const removeRollenBudgetRow = (key: string) => {
    setPoForm(f => ({ ...f, rollenBudgets: f.rollenBudgets.filter(rb => rb.key !== key) }))
  }

  const savePo = () => {
    if (!project) return
    const laufzeitStart = fromInputDate(poForm.laufzeitStart)
    if (!poForm.poNummer.trim() || !laufzeitStart || poForm.rollenBudgets.length === 0) {
      alert('PO-Nummer, Laufzeitbeginn und mindestens eine Rolle mit Budget sind erforderlich.')
      return
    }
    if ((state.purchaseOrders ?? []).some(po => po.poNummer === poForm.poNummer.trim() && po.id !== editPoId)) {
      alert('Diese PO-Nummer ist bereits vergeben.')
      return
    }

    if (editPoId) {
      const next = updatePurchaseOrder(
        state,
        editPoId,
        {
          poNummer: poForm.poNummer.trim(),
          laufzeitStart,
          laufzeitEnde: fromInputDate(poForm.laufzeitEnde),
          rollenBudgets: poForm.rollenBudgets.map(({ key: _key, ...rb }) => rb),
        },
        getCurrentUser() || undefined,
      )
      onStateUpdate(next)
      closePoForm()
      return
    }

    const next = createPurchaseOrder(
      state,
      {
        poNummer: poForm.poNummer.trim(),
        projectId: project.id,
        laufzeitStart,
        laufzeitEnde: fromInputDate(poForm.laufzeitEnde),
        vorherigePoId: renewFromPoId ?? undefined,
        rollenBudgets: poForm.rollenBudgets.map(({ key: _key, ...rb }) => rb),
      },
      getCurrentUser() || undefined,
    )
    onStateUpdate(next)
    closePoForm()
  }

  const openInitialForm = (role: BudgetRole) => {
    const existing = (state.budgetConsumption ?? []).find(
      e =>
        e.projectId === project?.id &&
        e.typ === 'initial' &&
        e.funktion === role.funktion &&
        e.level === role.level &&
        e.standort === role.standort,
    )
    setEditingInitialRole(role)
    setInitialForm({
      betrag: existing ? String(existing.betrag) : '',
      tage: existing?.tage ? String(existing.tage) : '',
    })
  }

  const saveInitial = () => {
    if (!project || !editingInitialRole) return
    const betrag = Number(initialForm.betrag.replace(',', '.'))
    if (!Number.isFinite(betrag) || betrag < 0) {
      alert('Bitte einen gültigen Betrag eingeben.')
      return
    }
    const tage = initialForm.tage ? Number(initialForm.tage.replace(',', '.')) : undefined

    onStateUpdate(
      recordInitialConsumption(
        state,
        {
          projectId: project.id,
          funktion: editingInitialRole.funktion,
          level: editingInitialRole.level,
          standort: editingInitialRole.standort,
          betrag,
          tage,
        },
        getCurrentUser() || undefined,
      ),
    )
    setEditingInitialRole(null)
  }

  const exportBudgetReport = () => {
    const stichtag = new Date()
    buildBudgetReportPdf(state, stichtag).save(budgetReportFileName(stichtag))
    onStateUpdate(
      appendAuditLog(
        state,
        'export',
        `Budgetbericht exportiert (Stand ${stichtag.toLocaleDateString('de-DE')})`,
        { detail: `${allProjectsReport.length} Projekt(e)`, by: getCurrentUser() || undefined },
      ),
    )
  }

  const uebernehmen = (rev: RevisionForMonth) => {
    if (!project) return
    onStateUpdate(
      recordLeistungsnachweisConsumption(
        state,
        project.id,
        rev.periode,
        consumptionLinesFromRevision(rev.lines),
        { snapshotId: rev.snapshotId, documentNumber: rev.documentNumber },
        getCurrentUser() || undefined,
      ),
    )
  }

  return (
    <section className="bm-container">
      <h2>Budget Tracking</h2>
      <p className="bm-description">
        Purchase Orders, Rollenbudgets und Verbrauch je Projekt. Die PO-Nummer ist zugleich die
        Vertragsnummer — bei einer Verlängerung entsteht eine neue Nummer, Restbudget und Verbrauch
        je Rolle laufen nahtlos weiter.
      </p>

      {!project && state.projects.length === 0 && (
        <div className="bm-warning">
          Noch keine Projekte vorhanden. Sie entstehen beim Zeiterfassungs-Import oder im Reiter Projekte.
        </div>
      )}

      {allProjectsReport.length > 0 && (
        <div className="bm-section">
          <div className="bm-section-head">
            <h3>Alle Projekte — Budgetbericht</h3>
            <button className="bm-btn-secondary" onClick={exportBudgetReport}>
              📄 Als PDF exportieren
            </button>
          </div>
          <p className="bm-field-hint">Stand: heute. Projekt zur Bearbeitung unten auswählen.</p>
          <table className="bm-table">
            <thead>
              <tr>
                <th>Projekt</th>
                <th>Aktive PO</th>
                <th className="bm-numeric">Budget</th>
                <th className="bm-numeric">Verbrauch</th>
                <th className="bm-numeric">Rest</th>
                <th className="bm-numeric">%</th>
              </tr>
            </thead>
            <tbody>
              {allProjectsReport.map(row => (
                <tr key={row.project.id}>
                  <td>{row.project.name}</td>
                  <td className="bm-mono">{row.active?.poNummer ?? '–'}</td>
                  <td className="bm-numeric">{currency(row.overview.gesamtBudget)}</td>
                  <td className="bm-numeric">{currency(row.overview.gesamtVerbrauch)}</td>
                  <td className={`bm-numeric ${row.overview.gesamtRest < 0 ? 'bm-negative' : ''}`}>
                    {currency(row.overview.gesamtRest)}
                  </td>
                  <td className="bm-numeric">{row.overview.prozent.toLocaleString('de-DE')} %</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr className="bm-report-total">
                <td colSpan={2}>Gesamt</td>
                <td className="bm-numeric">{currency(allProjectsTotals.gesamtBudget)}</td>
                <td className="bm-numeric">{currency(allProjectsTotals.gesamtVerbrauch)}</td>
                <td className={`bm-numeric ${allProjectsTotals.gesamtRest < 0 ? 'bm-negative' : ''}`}>
                  {currency(allProjectsTotals.gesamtRest)}
                </td>
                <td className="bm-numeric">{allProjectsTotals.prozent.toLocaleString('de-DE')} %</td>
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      <div className="bm-project-selector">
        <label htmlFor="bm-project">Projekt wählen:</label>
        <select id="bm-project" value={selectedProjectId} onChange={e => setSelectedProjectId(e.target.value)}>
          <option value="">-- Projekt auswählen --</option>
          {state.projects.map(p => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </div>

      {project && (
        <>
          <div className="bm-section">
            <div className="bm-section-head">
              <h3>
                Purchase Orders
                {active && <span className="bm-active-po-hint">Aktuell aktiv: {active.poNummer}</span>}
              </h3>
              <button className="bm-btn-primary" onClick={openNewPo} disabled={roleOptions.length === 0}>
                ➕ Neue PO
              </button>
            </div>

            {roleOptions.length === 0 && (
              <div className="bm-warning">
                Keine Rate Cards hinterlegt — ohne Funktion/Level-Kombinationen gibt es keine
                budgetierbaren Rollen. Im Reiter <strong>Rate Cards</strong> zuerst welche anlegen.
              </div>
            )}

            {pos.length === 0 ? (
              <p className="bm-empty">Noch keine PO für dieses Projekt angelegt.</p>
            ) : (
              <table className="bm-table">
                <thead>
                  <tr>
                    <th>PO / Vertragsnummer</th>
                    <th>Status</th>
                    <th>Laufzeit</th>
                    <th className="bm-numeric">Budget</th>
                    <th>Aktionen</th>
                  </tr>
                </thead>
                <tbody>
                  {pos.map(po => {
                    const budget = po.rollenBudgets.reduce((sum, rb) => sum + rb.betrag, 0)
                    const report =
                      expandedPoId === po.id
                        ? poStichtagReport(state, po.id, fromInputDate(poStichtagInput) ?? undefined)
                        : undefined

                    return (
                      <Fragment key={po.id}>
                        <tr>
                          <td className="bm-mono">{po.poNummer}</td>
                          <td>
                            <span className={`bm-status bm-status-${po.status}`}>
                              {po.status === 'aktiv' ? 'Aktiv' : 'Abgelöst'}
                            </span>
                          </td>
                          <td>
                            {new Date(po.laufzeitStart).toLocaleDateString('de-DE')}
                            {' – '}
                            {po.laufzeitEnde ? new Date(po.laufzeitEnde).toLocaleDateString('de-DE') : 'offen'}
                          </td>
                          <td className="bm-numeric">{currency(budget)}</td>
                          <td className="bm-actions">
                            {po.status === 'aktiv' && (
                              <button className="bm-btn-secondary" onClick={() => openRenewPo(po)}>
                                Verlängern
                              </button>
                            )}
                            <button className="bm-btn-secondary" onClick={() => openEditPo(po)}>
                              Bearbeiten
                            </button>
                            <button
                              className="bm-btn-secondary"
                              onClick={() => {
                                if (expandedPoId === po.id) {
                                  setExpandedPoId(null)
                                  return
                                }
                                setExpandedPoId(po.id)
                                setPoStichtagInput(toInputDate(po.laufzeitEnde ? new Date(po.laufzeitEnde) : new Date()))
                              }}
                            >
                              {expandedPoId === po.id ? 'Bericht schließen' : 'Stichtagsbericht'}
                            </button>
                          </td>
                        </tr>
                        {report && (
                          <tr className="bm-report-row">
                            <td colSpan={5}>
                              <div className="bm-report">
                                <div className="bm-report-head">
                                  <strong>Stichtagsbericht</strong>
                                  <label>
                                    Stichtag:{' '}
                                    <input
                                      type="date"
                                      value={poStichtagInput}
                                      onChange={e => setPoStichtagInput(e.target.value)}
                                    />
                                  </label>
                                </div>
                                <table className="bm-table bm-table-nested">
                                  <thead>
                                    <tr>
                                      <th>Rolle</th>
                                      <th className="bm-numeric">Budget bis Stichtag</th>
                                      <th className="bm-numeric">Verbrauch bis Stichtag</th>
                                      <th className="bm-numeric">Rest</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {report.roles.map(r => (
                                      <tr key={`${r.funktion}|${r.level}|${r.standort}`}>
                                        <td>{roleLabel(r)}</td>
                                        <td className="bm-numeric">{currency(r.budget)}</td>
                                        <td className="bm-numeric">{currency(r.verbrauch)}</td>
                                        <td className={`bm-numeric ${r.rest < 0 ? 'bm-negative' : ''}`}>
                                          {currency(r.rest)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                                <p className="bm-field-hint">
                                  Ungenutztes Restbudget verfällt nicht — es bleibt Teil des gemeinsamen
                                  Rollen-Budgets und wird von der Folge-PO einfach mitgeführt.
                                </p>
                              </div>
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {overview && (
            <div className="bm-section">
              <div className="bm-section-head">
                <h3>Budgetübersicht</h3>
                <label className="bm-stichtag-label">
                  Stand zum:{' '}
                  <input type="date" value={stichtagInput} onChange={e => setStichtagInput(e.target.value)} />
                  {stichtagInput && (
                    <button className="bm-btn-link" onClick={() => setStichtagInput('')}>
                      heute
                    </button>
                  )}
                </label>
              </div>

              <div className="bm-summary-tiles">
                <div className="bm-tile">
                  <span className="bm-tile-label">Gesamtbudget</span>
                  <span className="bm-tile-value">{currency(overview.gesamtBudget)}</span>
                </div>
                <div className="bm-tile">
                  <span className="bm-tile-label">Verbraucht</span>
                  <span className="bm-tile-value">
                    {currency(overview.gesamtVerbrauch)} <small>({overview.prozent.toLocaleString('de-DE')} %)</small>
                  </span>
                </div>
                <div className="bm-tile">
                  <span className="bm-tile-label">Restbudget</span>
                  <span className={`bm-tile-value ${overview.gesamtRest < 0 ? 'bm-negative' : ''}`}>
                    {currency(overview.gesamtRest)}
                  </span>
                </div>
              </div>

              {overview.roles.length === 0 ? (
                <p className="bm-empty">Noch keine Rollen mit Budget in diesem Projekt.</p>
              ) : (
                <table className="bm-table">
                  <thead>
                    <tr>
                      <th>Rolle</th>
                      <th className="bm-numeric">Budget</th>
                      <th className="bm-numeric">Verbrauch</th>
                      <th className="bm-numeric">Rest</th>
                      <th className="bm-numeric">%</th>
                      <th className="bm-numeric">Tage Rest</th>
                    </tr>
                  </thead>
                  <tbody>
                    {overview.roles.map(r => (
                      <tr key={`${r.funktion}|${r.level}|${r.standort}`}>
                        <td>{roleLabel(r)}</td>
                        <td className="bm-numeric">{currency(r.budget)}</td>
                        <td className="bm-numeric">{currency(r.verbrauch)}</td>
                        <td className={`bm-numeric ${r.rest < 0 ? 'bm-negative' : ''}`}>{currency(r.rest)}</td>
                        <td className="bm-numeric">{r.prozent.toLocaleString('de-DE')} %</td>
                        <td className="bm-numeric">{r.restTage ? r.restTage.toLocaleString('de-DE') : '–'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          )}

          {timeline.length > 0 && (
            <div className="bm-section">
              <h3>Verbrauch im Zeitverlauf</h3>
              <div className="bm-timeline-grid">
                <table className="bm-table bm-table-compact">
                  <thead>
                    <tr>
                      <th>Monat</th>
                      <th className="bm-numeric">Verbrauch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {timeline.map(t => (
                      <tr key={t.periode}>
                        <td>{t.periode}</td>
                        <td className="bm-numeric">{currency(t.betrag)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <table className="bm-table bm-table-compact">
                  <thead>
                    <tr>
                      <th>Jahr</th>
                      <th className="bm-numeric">Verbrauch</th>
                    </tr>
                  </thead>
                  <tbody>
                    {yearly.map(([year, betrag]) => (
                      <tr key={year}>
                        <td>{year}</td>
                        <td className="bm-numeric">{currency(betrag)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          <div className="bm-section">
            <h3>Historische Verbräuche (Initialwerte)</h3>
            <p className="bm-field-hint">
              Einmalige Gesamtsumme pro Rolle für die Zeit vor dem Tracking-Start. Eine erneute
              Erfassung korrigiert den Wert und wird im Prüfpfad festgehalten.
            </p>
            {roles.length === 0 ? (
              <p className="bm-empty">Noch keine Rollen — zuerst eine PO mit Rollenbudget anlegen.</p>
            ) : (
              <table className="bm-table">
                <thead>
                  <tr>
                    <th>Rolle</th>
                    <th className="bm-numeric">Initialwert</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {roles.map(role => {
                    const entry = (state.budgetConsumption ?? []).find(
                      e =>
                        e.projectId === project.id &&
                        e.typ === 'initial' &&
                        e.funktion === role.funktion &&
                        e.level === role.level &&
                        e.standort === role.standort,
                    )
                    return (
                      <tr key={`${role.funktion}|${role.level}|${role.standort}`}>
                        <td>{roleLabel(role)}</td>
                        <td className="bm-numeric">
                          {entry ? currency(entry.betrag) : <span className="bm-missing">nicht erfasst</span>}
                        </td>
                        <td>
                          <button className="bm-btn-secondary" onClick={() => openInitialForm(role)}>
                            {entry ? 'Korrigieren' : 'Erfassen'}
                          </button>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}
          </div>

          {openRevisions.length > 0 && (
            <div className="bm-section">
              <h3>Verbrauch aus Leistungsnachweisen</h3>
              <p className="bm-field-hint">
                Übernimmt die Rollenbeträge einer abgeschlossenen Abrechnung als Verbrauch des
                jeweiligen Monats — ein erneuter Klick ersetzt eine bereits übernommene Periode.
              </p>
              <table className="bm-table">
                <thead>
                  <tr>
                    <th>Monat</th>
                    <th>Beleg</th>
                    <th className="bm-numeric">Betrag</th>
                    <th>Status</th>
                    <th>Aktion</th>
                  </tr>
                </thead>
                <tbody>
                  {openRevisions.map(rev => (
                    <tr key={rev.snapshotId}>
                      <td>{rev.periode}</td>
                      <td className="bm-mono">{rev.documentNumber ?? '–'}</td>
                      <td className="bm-numeric">{currency(rev.lines.reduce((s, l) => s + l.betrag, 0))}</td>
                      <td>
                        {recordedPeriods.has(rev.periode) ? (
                          <span className="bm-status bm-status-aktiv">Übernommen</span>
                        ) : (
                          <span className="bm-missing">offen</span>
                        )}
                      </td>
                      <td>
                        <button className="bm-btn-secondary" onClick={() => uebernehmen(rev)}>
                          Übernehmen
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}

      {showPoForm && project && (
        <div className="bm-modal-overlay" onClick={closePoForm}>
          <div className="bm-modal" onClick={e => e.stopPropagation()}>
            <h3>{editPoId ? 'PO bearbeiten' : renewFromPoId ? 'Folge-PO anlegen' : 'Neue PO anlegen'}</h3>
            {renewFromPoId && (
              <p className="bm-field-hint">
                Verlängert die bisherige PO. Sie wird beim Speichern automatisch als abgelöst markiert,
                bleibt aber vollständig einsehbar.
              </p>
            )}
            {editPoId && (
              <p className="bm-field-hint">
                Ändert diese PO direkt — z.B. um eine falsch angelegte Rolle zu korrigieren. Status und
                PO-Kette bleiben unverändert; bereits erfasster Verbrauch hängt an der Rolle, nicht an
                der PO, und bleibt davon unberührt.
              </p>
            )}

            <div className="bm-form-group">
              <label htmlFor="bm-po-nummer">PO-/Vertragsnummer *</label>
              <input
                id="bm-po-nummer"
                type="text"
                value={poForm.poNummer}
                onChange={e => setPoForm(f => ({ ...f, poNummer: e.target.value }))}
                placeholder="z.B. 4500129981"
                autoFocus
              />
            </div>

            <div className="bm-form-row">
              <div className="bm-form-group">
                <label htmlFor="bm-po-start">Laufzeitbeginn *</label>
                <input
                  id="bm-po-start"
                  type="date"
                  value={poForm.laufzeitStart}
                  onChange={e => setPoForm(f => ({ ...f, laufzeitStart: e.target.value }))}
                />
              </div>
              <div className="bm-form-group">
                <label htmlFor="bm-po-ende">Laufzeitende</label>
                <input
                  id="bm-po-ende"
                  type="date"
                  value={poForm.laufzeitEnde}
                  onChange={e => setPoForm(f => ({ ...f, laufzeitEnde: e.target.value }))}
                />
              </div>
            </div>

            <div className="bm-form-group">
              <div className="bm-rollen-head">
                <label>Rollenbudgets *</label>
                <button type="button" className="bm-btn-secondary" onClick={addRollenBudgetRow}>
                  + Rolle
                </button>
              </div>
              {poForm.rollenBudgets.length === 0 && <p className="bm-field-hint">Noch keine Rolle hinzugefügt.</p>}
              {poForm.rollenBudgets.map(rb => (
                <div className="bm-rollen-row" key={rb.key}>
                  <select
                    value={`${rb.funktion}|${rb.level}|${rb.standort}`}
                    onChange={e => {
                      const [funktion, level, standort] = e.target.value.split('|')
                      updateRollenBudgetRow(rb.key, {
                        funktion,
                        level: level as RateCard['level'],
                        standort: standort as RateCard['standort'],
                      })
                    }}
                  >
                    {roleOptions.map(o => (
                      <option key={`${o.funktion}|${o.level}|${o.standort}`} value={`${o.funktion}|${o.level}|${o.standort}`}>
                        {o.level} {o.funktion} · {o.standort}
                      </option>
                    ))}
                  </select>
                  <input
                    type="number"
                    placeholder="Budget €"
                    value={rb.betrag || ''}
                    onChange={e => updateRollenBudgetRow(rb.key, { betrag: Number(e.target.value) || 0 })}
                  />
                  <input
                    type="number"
                    placeholder="Tage"
                    value={rb.tage || ''}
                    onChange={e =>
                      updateRollenBudgetRow(rb.key, { tage: e.target.value ? Number(e.target.value) : undefined })
                    }
                  />
                  <button type="button" className="bm-btn-delete" onClick={() => removeRollenBudgetRow(rb.key)}>
                    🗑
                  </button>
                </div>
              ))}
            </div>

            <div className="bm-modal-actions">
              <button className="bm-btn-secondary" onClick={closePoForm}>
                Abbrechen
              </button>
              <button className="bm-btn-primary" onClick={savePo}>
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}

      {editingInitialRole && (
        <div className="bm-modal-overlay" onClick={() => setEditingInitialRole(null)}>
          <div className="bm-modal" onClick={e => e.stopPropagation()}>
            <h3>Initialwert {roleLabel(editingInitialRole)}</h3>
            <div className="bm-form-group">
              <label htmlFor="bm-initial-betrag">Historischer Gesamtverbrauch (€) *</label>
              <input
                id="bm-initial-betrag"
                type="number"
                value={initialForm.betrag}
                onChange={e => setInitialForm(f => ({ ...f, betrag: e.target.value }))}
                autoFocus
              />
            </div>
            <div className="bm-form-group">
              <label htmlFor="bm-initial-tage">Tage (optional)</label>
              <input
                id="bm-initial-tage"
                type="number"
                value={initialForm.tage}
                onChange={e => setInitialForm(f => ({ ...f, tage: e.target.value }))}
              />
            </div>
            <div className="bm-modal-actions">
              <button className="bm-btn-secondary" onClick={() => setEditingInitialRole(null)}>
                Abbrechen
              </button>
              <button className="bm-btn-primary" onClick={saveInitial}>
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
