import { useMemo, useState } from 'react'
import type { Employee, ProjectResourceAssignment, ProjectState, RateCard } from '../types'
import { findProjectByName, findRateCard } from '../lib/roleResolution'
import { unresolvedAcrossSnapshots } from '../lib/billingAggregation'
import { formatHours } from '../lib/rounding'
import '../styles/ProjectRoleAssignmentManager.css'

interface ProjectRoleAssignmentManagerProps {
  state: ProjectState
  onStateUpdate: (state: ProjectState) => void
}

/** Eine auswählbare Abrechnungs-Rolle - immer durch eine Rate Card gedeckt. */
interface RateOption {
  key: string
  funktion: string
  level: RateCard['level']
  standort: RateCard['standort']
  tagessatz: number
}

const currency = (v: number) => `${v.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`

export function ProjectRoleAssignmentManager({
  state,
  onStateUpdate,
}: ProjectRoleAssignmentManagerProps) {
  const [selectedProjectId, setSelectedProjectId] = useState<string>('')
  const [showForm, setShowForm] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [formData, setFormData] = useState({ employeeId: '', rateKey: '' })

  const assignments = state.projectAssignments ?? []
  const currentProject = state.projects.find(p => p.id === selectedProjectId)
  const currentAssignments = assignments.filter(pa => pa.projectId === selectedProjectId)

  /**
   * Wählbar ist genau das, wofür ein Tagessatz hinterlegt ist. Damit kann keine
   * Zuordnung entstehen, die später stumm mit 0 € abgerechnet wird.
   */
  const rateOptions = useMemo<RateOption[]>(() => {
    const byKey = new Map<string, RateOption>()

    state.rateCards.forEach(rc => {
      const key = `${rc.funktion}|${rc.level}|${rc.standort}`
      // Mehrere Karten je Kombination sind Tarifstände - für die Auswahl genügt eine
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          funktion: rc.funktion,
          level: rc.level,
          standort: rc.standort,
          tagessatz: rc.tagessatz,
        })
      }
    })

    const levelOrder = ['Expert', 'Senior', 'Intermediate', 'Junior']
    return Array.from(byKey.values()).sort(
      (a, b) =>
        a.funktion.localeCompare(b.funktion) ||
        levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level) ||
        a.standort.localeCompare(b.standort)
    )
  }, [state.rateCards])

  /** Nach Funktion gruppiert, damit die Auswahlliste lesbar bleibt. */
  const groupedOptions = useMemo(() => {
    const groups = new Map<string, RateOption[]>()
    rateOptions.forEach(option => {
      const list = groups.get(option.funktion) ?? []
      list.push(option)
      groups.set(option.funktion, list)
    })
    return Array.from(groups.entries())
  }, [rateOptions])

  /** Nur Mitarbeiter anbieten, die im Projekt tatsächlich Zeit gebucht haben. */
  const projectEmployees = useMemo<Employee[]>(() => {
    if (!currentProject) return []

    const booked = new Set<string>()
    state.snapshots.forEach(snapshot => {
      snapshot.timeEntries.forEach(entry => {
        if (findProjectByName(entry.projectName, state.projects)?.id === currentProject.id) {
          booked.add(entry.resource)
        }
      })
    })

    const withBookings = state.employees.filter(e => booked.has(e.name))
    return withBookings.length > 0 ? withBookings : state.employees
  }, [currentProject, state.snapshots, state.projects, state.employees])

  const handleAddClick = () => {
    setEditingId(null)
    setFormData({ employeeId: '', rateKey: '' })
    setShowForm(true)
  }

  const handleEdit = (assignment: ProjectResourceAssignment) => {
    setEditingId(assignment.id)
    setFormData({
      employeeId: assignment.employeeId,
      rateKey: `${assignment.funktion}|${assignment.level}|${assignment.standort}`,
    })
    setShowForm(true)
  }

  const handleSave = () => {
    if (!formData.employeeId || !formData.rateKey || !currentProject) {
      alert('Bitte Mitarbeiter und Abrechnungs-Rolle wählen')
      return
    }

    const employee = state.employees.find(e => e.id === formData.employeeId)
    const option = rateOptions.find(o => o.key === formData.rateKey)

    if (!employee || !option) {
      alert('Mitarbeiter oder Rate Card nicht gefunden')
      return
    }

    // Eine Rolle je Person und Projekt - sonst wäre die Abrechnung nicht eindeutig.
    const duplicate = assignments.find(
      pa =>
        pa.projectId === currentProject.id &&
        pa.employeeId === formData.employeeId &&
        pa.id !== editingId
    )
    if (duplicate) {
      alert(
        `${employee.name} ist in diesem Projekt bereits als ` +
          `${duplicate.level} ${duplicate.funktion} zugeordnet.`
      )
      return
    }

    const next: ProjectResourceAssignment = {
      id: editingId ?? `pa-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
      projectId: currentProject.id,
      employeeId: employee.id,
      employeeName: employee.name,
      funktion: option.funktion,
      level: option.level,
      standort: option.standort,
    }

    const updated = editingId
      ? assignments.map(pa => (pa.id === editingId ? next : pa))
      : [...assignments, next]

    onStateUpdate({ ...state, projectAssignments: updated })
    setShowForm(false)
  }

  const handleDelete = (id: string) => {
    if (!confirm('Zuordnung wirklich löschen? Der Mitarbeiter hat danach keine Rolle mehr in diesem Projekt.'))
      return
    onStateUpdate({ ...state, projectAssignments: assignments.filter(pa => pa.id !== id) })
  }

  const rateFor = (a: Pick<ProjectResourceAssignment, 'funktion' | 'level' | 'standort'>) =>
    findRateCard(a, state.rateCards)

  const unassigned = projectEmployees.filter(
    emp => !currentAssignments.some(pa => pa.employeeId === emp.id)
  )

  const selectedOption = rateOptions.find(o => o.key === formData.rateKey)

  // Über alle Projekte hinweg: wo fehlt die Projektzuordnung. Genau das
  // blockiert den Monatsabschluss (revisions.canLockSnapshot).
  const unresolved = useMemo(() => unresolvedAcrossSnapshots(state), [state])

  const openAssignFor = (employeeId: string, projectId: string) => {
    setSelectedProjectId(projectId)
    setEditingId(null)
    setFormData({ employeeId, rateKey: '' })
    setShowForm(true)
  }

  return (
    <section className="pram-container">
      <h2>Projekt-Rollen-Zuweisungen</h2>
      <p className="pram-description">
        Eine Person kann in verschiedenen Projekten unterschiedlich abgerechnet werden — etwa als
        Senior Architekt im einen und als Expert Software Engineer im anderen. Pro Projekt gilt
        genau eine Rolle. Wählbar ist nur, wofür eine Rate Card einen Tagessatz hinterlegt hat.
      </p>

      {unresolved.length > 0 && (
        <div className="pram-warning pram-warning-clarify">
          <h3 style={{ margin: '0 0 8px' }}>
            ⚠️ Offene Zuordnungen ({unresolved.length})
          </h3>
          <p style={{ margin: '0 0 10px' }}>
            Diese Mitarbeiter haben fakturierbare Stunden gebucht, aber noch keine Projektrolle.
            Ohne Zuordnung lässt sich der betroffene Monat nicht abschließen.
          </p>
          <table className="pram-table">
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th>Projekt</th>
                <th className="pram-numeric pram-col-fit">Stunden</th>
                <th className="pram-col-fit">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {unresolved.map(row => (
                <tr key={`${row.employeeId}|${row.projectId ?? row.projectName}`}>
                  <td>{row.employeeName}</td>
                  <td>{row.projectName}</td>
                  <td className="pram-numeric">{formatHours(row.hours)}</td>
                  <td>
                    {row.projectId ? (
                      <button
                        className="pram-btn-primary"
                        onClick={() => openAssignFor(row.employeeId, row.projectId!)}
                      >
                        Jetzt zuordnen
                      </button>
                    ) : (
                      <span className="pram-muted">Projekt „{row.projectName}“ nicht angelegt</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {state.projects.length === 0 && (
        <div className="pram-warning">
          Noch keine Projekte vorhanden. Sie entstehen beim Zeiterfassungs-Import im Reiter{' '}
          <strong>Import</strong>.
        </div>
      )}

      {rateOptions.length === 0 && (
        <div className="pram-warning">
          Keine Rate Cards hinterlegt — ohne Tagessätze gibt es nichts zuzuordnen. Im Reiter{' '}
          <strong>Rate Cards</strong> die Vorlage herunterladen, ausfüllen und importieren.
        </div>
      )}

      <div className="pram-project-selector">
        <label htmlFor="pram-project">Projekt wählen:</label>
        <select
          id="pram-project"
          value={selectedProjectId}
          onChange={e => setSelectedProjectId(e.target.value)}
        >
          <option value="">-- Projekt auswählen --</option>
          {state.projects.map(project => {
            const count = assignments.filter(pa => pa.projectId === project.id).length
            return (
              <option key={project.id} value={project.id}>
                {project.name}
                {count > 0 ? ` (${count} Zuordnung${count === 1 ? '' : 'en'})` : ''}
              </option>
            )
          })}
        </select>
      </div>

      {currentProject && (
        <>
          <div className="pram-header">
            <h3>
              {currentProject.name}
              {currentProject.purchaseOrder && (
                <span className="pram-po">PO {currentProject.purchaseOrder}</span>
              )}
            </h3>
            <button
              className="pram-btn-primary"
              onClick={handleAddClick}
              disabled={rateOptions.length === 0}
            >
              ➕ Zuordnung hinzufügen
            </button>
          </div>

          {currentAssignments.length === 0 ? (
            <div className="pram-empty">
              <p>
                Noch keine Rollen zugeordnet. {projectEmployees.length} Mitarbeiter mit Buchungen
                in diesem Projekt haben noch keine Rolle.
              </p>
            </div>
          ) : (
            <table className="pram-table">
              <thead>
                <tr>
                  <th>Mitarbeiter</th>
                  <th>Rolle</th>
                  <th className="pram-numeric pram-col-fit">Tagessatz</th>
                  <th className="pram-col-fit">Aktionen</th>
                </tr>
              </thead>
              <tbody>
                {currentAssignments.map(assignment => {
                  const card = rateFor(assignment)
                  return (
                    <tr key={assignment.id}>
                      <td>{assignment.employeeName}</td>
                      <td>
                        <strong>
                          {assignment.level} {assignment.funktion}
                        </strong>
                        <span className="pram-standort">{assignment.standort}</span>
                      </td>
                      <td className="pram-numeric">
                        {card ? (
                          currency(card.tagessatz)
                        ) : (
                          <span className="pram-no-rate" title="Keine passende Rate Card">
                            fehlt
                          </span>
                        )}
                      </td>
                      <td className="pram-actions">
                        <button className="pram-btn-edit" onClick={() => handleEdit(assignment)}>
                          ✎ Bearbeiten
                        </button>
                        <button
                          className="pram-btn-delete"
                          onClick={() => handleDelete(assignment.id)}
                        >
                          🗑 Löschen
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}

          {unassigned.length > 0 && currentAssignments.length > 0 && (
            <p className="pram-hint pram-hint-warning">
              Noch ohne Rolle in diesem Projekt: {unassigned.map(e => e.name).join(', ')}
            </p>
          )}
        </>
      )}

      {showForm && currentProject && (
        <div className="pram-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="pram-modal" onClick={e => e.stopPropagation()}>
            <h3>{editingId ? 'Zuordnung bearbeiten' : 'Neue Zuordnung'}</h3>

            <div className="pram-form-group">
              <label htmlFor="pram-employee">Mitarbeiter *</label>
              <select
                id="pram-employee"
                value={formData.employeeId}
                onChange={e => setFormData({ ...formData, employeeId: e.target.value })}
              >
                <option value="">-- Mitarbeiter wählen --</option>
                {projectEmployees.map(emp => (
                  <option key={emp.id} value={emp.id}>
                    {emp.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="pram-form-group">
              <label htmlFor="pram-rate">Abrechnung in diesem Projekt *</label>
              <select
                id="pram-rate"
                value={formData.rateKey}
                onChange={e => setFormData({ ...formData, rateKey: e.target.value })}
              >
                <option value="">-- Rate Card wählen --</option>
                {groupedOptions.map(([funktion, options]) => (
                  <optgroup key={funktion} label={funktion}>
                    {options.map(option => (
                      <option key={option.key} value={option.key}>
                        {option.level} · {option.standort} · {currency(option.tagessatz)}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
              <p className="pram-field-hint">
                Die Liste zeigt jede Kombination, für die ein Tagessatz hinterlegt ist. Fehlt eine,
                gehört sie in die Rate-Card-Vorlage.
              </p>
            </div>

            {selectedOption && (
              <div className="pram-preview">
                Abrechnung mit <strong>{currency(selectedOption.tagessatz)}</strong> pro Tag ·{' '}
                {selectedOption.level} {selectedOption.funktion} · {selectedOption.standort}
              </div>
            )}

            <div className="pram-modal-actions">
              <button className="pram-btn-secondary" onClick={() => setShowForm(false)}>
                Abbrechen
              </button>
              <button className="pram-btn-primary" onClick={handleSave}>
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
