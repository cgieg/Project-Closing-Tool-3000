import { useMemo, useState } from 'react'
import type { Project, ProjectState } from '../types'
import { findProjectByName } from '../lib/roleResolution'
import '../styles/ProjectEditor.css'

interface ProjectEditorProps {
  state: ProjectState
  onStateUpdate: (state: ProjectState) => void
}

interface FormData {
  name: string
  bundleId: string
  purchaseOrder: string
  aliases: string
  fakturierbar: boolean
}

const emptyForm: FormData = {
  name: '',
  bundleId: '',
  purchaseOrder: '',
  aliases: '',
  fakturierbar: true,
}

export function ProjectEditor({ state, onStateUpdate }: ProjectEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [formData, setFormData] = useState<FormData>(emptyForm)

  /**
   * Projektnamen, die in den Zeiteinträgen vorkommen, aber zu keinem Projekt führen.
   * Sie sind die Vorlage für Aliase - so bindet man ein vorbereitetes Projekt an die
   * Bezeichnung, die die Zeiterfassung tatsächlich liefert.
   */
  const unmatchedNames = useMemo(() => {
    const names = new Set<string>()
    state.snapshots.forEach(snapshot => {
      snapshot.timeEntries.forEach(entry => {
        if (entry.projectName && !findProjectByName(entry.projectName, state.projects)) {
          names.add(entry.projectName)
        }
      })
    })
    return Array.from(names).sort()
  }, [state.snapshots, state.projects])

  const bookedNames = useMemo(() => {
    const counts = new Map<string, number>()
    state.snapshots.forEach(snapshot => {
      snapshot.timeEntries.forEach(entry => {
        const project = findProjectByName(entry.projectName, state.projects)
        if (project) counts.set(project.id, (counts.get(project.id) ?? 0) + 1)
      })
    })
    return counts
  }, [state.snapshots, state.projects])

  const openCreate = () => {
    setCreating(true)
    setEditingId(null)
    setFormData({ ...emptyForm, bundleId: state.bundles[0]?.id ?? '' })
  }

  const openEdit = (project: Project) => {
    setCreating(false)
    setEditingId(project.id)
    setFormData({
      name: project.name,
      bundleId: project.bundleId,
      purchaseOrder: project.purchaseOrder ?? '',
      aliases: (project.aliases ?? []).join('\n'),
      fakturierbar: project.fakturierbar !== false,
    })
  }

  const close = () => {
    setEditingId(null)
    setCreating(false)
  }

  const handleSave = () => {
    const name = formData.name.trim()
    if (!name) {
      alert('Projektname erforderlich')
      return
    }

    const aliases = formData.aliases
      .split('\n')
      .map(a => a.trim())
      .filter(Boolean)

    // Name und Aliase muessen projektweit eindeutig sein, sonst waere der
    // Abgleich beim Import nicht mehr entscheidbar.
    const collision = state.projects.find(p => {
      if (p.id === editingId) return false
      const own = [p.name, ...(p.aliases ?? [])].map(x => x.trim().toLowerCase())
      return [name, ...aliases].some(x => own.includes(x.trim().toLowerCase()))
    })
    if (collision) {
      alert(`Name oder Alias wird bereits von "${collision.name}" verwendet.`)
      return
    }

    const fields = {
      name,
      bundleId: formData.bundleId || state.bundles[0]?.id || '',
      purchaseOrder: formData.purchaseOrder.trim() || undefined,
      aliases: aliases.length > 0 ? aliases : undefined,
      // Nur speichern, wenn abweichend vom Standard (fakturierbar) - hält
      // Altbestände ohne das Feld unverändert lesbar.
      fakturierbar: formData.fakturierbar ? undefined : false,
    }

    const projects = editingId
      ? state.projects.map(p => (p.id === editingId ? { ...p, ...fields } : p))
      : [
          ...state.projects,
          { id: `project-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`, ...fields },
        ]

    onStateUpdate({ ...state, projects })
    close()
  }

  const handleDelete = (project: Project) => {
    const bookings = bookedNames.get(project.id) ?? 0
    const warning =
      bookings > 0
        ? `Auf "${project.name}" sind ${bookings} Zeiteinträge gebucht. ` +
          'Nach dem Löschen werden sie keinem Projekt mehr zugeordnet und fallen aus der ' +
          'Abrechnung. Wirklich löschen?'
        : `Projekt "${project.name}" wirklich löschen?`

    if (!confirm(warning)) return

    onStateUpdate({
      ...state,
      projects: state.projects.filter(p => p.id !== project.id),
      // Zuordnungen ohne Projekt waeren Datenmuell
      projectAssignments: (state.projectAssignments ?? []).filter(
        pa => pa.projectId !== project.id
      ),
    })
  }

  const addAlias = (name: string) => {
    const existing = formData.aliases.split('\n').map(a => a.trim()).filter(Boolean)
    if (existing.includes(name)) return
    setFormData({ ...formData, aliases: [...existing, name].join('\n') })
  }

  const showForm = creating || editingId !== null

  return (
    <div className="project-editor">
      <div className="project-editor-header">
        <h3>Projekte verwalten</h3>
        <button className="project-btn-primary" onClick={openCreate}>
          ➕ Neues Projekt
        </button>
      </div>

      <p className="project-editor-intro">
        Projekte entstehen beim Zeiterfassungs-Import automatisch — hier lassen sie sich auch vorab
        anlegen, damit PO-Nummer, Budget und Rollen schon vor dem Monatsabschluss stehen. Der
        Import erkennt sie am Namen und lässt alles Eingetragene unangetastet.
      </p>

      {unmatchedNames.length > 0 && (
        <div className="project-editor-warning">
          <strong>Ohne Projekt gebucht:</strong> {unmatchedNames.join(', ')}
          <br />
          Diese Bezeichnungen kommen in Zeiteinträgen vor, führen aber zu keinem Projekt. Trage
          sie beim passenden Projekt als Alias ein.
        </div>
      )}

      {state.projects.length === 0 ? (
        <p className="project-editor-empty">
          Noch keine Projekte. Lege sie hier an oder importiere Zeiteinträge.
        </p>
      ) : (
        <div className="project-editor-table-wrapper">
          <table className="project-editor-table">
            <thead>
              <tr>
                <th>Projektname</th>
                <th>Bundle</th>
                <th>PO</th>
                <th className="project-numeric">Buchungen</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {state.projects.map(project => {
                const bookings = bookedNames.get(project.id) ?? 0
                return (
                  <tr key={project.id}>
                    <td>
                      {project.name}
                      {project.aliases && project.aliases.length > 0 && (
                        <span className="project-alias" title={project.aliases.join(', ')}>
                          +{project.aliases.length} Alias
                        </span>
                      )}
                      {project.fakturierbar === false && (
                        <span className="project-alias" title="Geht mit 0 € in die Abrechnung ein">
                          nicht fakturierbar
                        </span>
                      )}
                    </td>
                    <td className="project-muted">
                      {state.bundles.find(b => b.id === project.bundleId)?.name ?? '—'}
                    </td>
                    <td>
                      {project.purchaseOrder ?? <span className="project-missing">fehlt</span>}
                    </td>
                    <td className="project-numeric">
                      {bookings > 0 ? bookings : <span className="project-muted">0</span>}
                    </td>
                    <td className="project-actions">
                      <button className="project-btn-edit" onClick={() => openEdit(project)}>
                        ✎ Bearbeiten
                      </button>
                      <button className="project-btn-delete" onClick={() => handleDelete(project)}>
                        🗑 Löschen
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="project-editor-modal-overlay" onClick={close}>
          <div className="project-editor-modal" onClick={e => e.stopPropagation()}>
            <h4>{creating ? 'Neues Projekt' : 'Projekt bearbeiten'}</h4>

            <div className="project-editor-form-group">
              <label htmlFor="pe-name">Projektname *</label>
              <input
                id="pe-name"
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="z.B. Atlas"
                autoFocus
              />
            </div>

            <div className="project-editor-form-group">
              <label htmlFor="pe-bundle">Bundle</label>
              <select
                id="pe-bundle"
                value={formData.bundleId}
                onChange={e => setFormData({ ...formData, bundleId: e.target.value })}
              >
                {state.bundles.length === 0 && <option value="">— kein Bundle vorhanden —</option>}
                {state.bundles.map(bundle => (
                  <option key={bundle.id} value={bundle.id}>
                    {bundle.name}
                  </option>
                ))}
              </select>
            </div>

            <div className="project-editor-form-group">
              <label htmlFor="pe-po">Purchase Order (PO)</label>
              <input
                id="pe-po"
                type="text"
                value={formData.purchaseOrder}
                onChange={e => setFormData({ ...formData, purchaseOrder: e.target.value })}
                placeholder="z.B. PO-123456"
              />
            </div>

            <div className="project-editor-form-group">
              <label>
                <input
                  type="checkbox"
                  checked={formData.fakturierbar}
                  onChange={e => setFormData({ ...formData, fakturierbar: e.target.checked })}
                />
                {' '}Fakturierbar
              </label>
              <p className="project-field-hint">
                Deaktiviert: das gesamte Projekt geht mit 0 € in die Abrechnung ein — unabhängig
                von WBS und der Abrechenbar-Kennzeichnung einzelner Zeiteinträge.
              </p>
            </div>

            <div className="project-editor-form-group">
              <label htmlFor="pe-aliases">Alias-Namen aus der Zeiterfassung</label>
              <textarea
                id="pe-aliases"
                value={formData.aliases}
                onChange={e => setFormData({ ...formData, aliases: e.target.value })}
                rows={3}
                placeholder={'Atlas - Productive\nAtlas - Non Productive'}
              />
              <p className="project-field-hint">
                Ein Name je Zeile. Die Zeiterfassung liefert Bezeichnungen wie „Atlas - Productive"; damit
                findet der Import dieses Projekt trotzdem.
              </p>

              {unmatchedNames.length > 0 && (
                <div className="project-alias-suggestions">
                  <span>Nicht zugeordnet:</span>
                  {unmatchedNames.map(name => (
                    <button key={name} type="button" onClick={() => addAlias(name)}>
                      + {name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            <div className="project-editor-modal-actions">
              <button className="project-btn-secondary" onClick={close}>
                Abbrechen
              </button>
              <button className="project-btn-primary" onClick={handleSave}>
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
