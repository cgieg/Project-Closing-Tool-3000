import { useState } from 'react'
import type { Bundle, ProjectState } from '../types'
import '../styles/ProjectEditor.css'

interface BundleEditorProps {
  state: ProjectState
  onStateUpdate: (state: ProjectState) => void
}

interface FormData {
  name: string
  kunde: string
  vertragsnummer: string
}

const emptyForm: FormData = { name: '', kunde: '', vertragsnummer: '' }

export function BundleEditor({ state, onStateUpdate }: BundleEditorProps) {
  const [editingId, setEditingId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [formData, setFormData] = useState<FormData>(emptyForm)

  const openCreate = () => {
    setCreating(true)
    setEditingId(null)
    setFormData(emptyForm)
  }

  const openEdit = (bundle: Bundle) => {
    setCreating(false)
    setEditingId(bundle.id)
    setFormData({
      name: bundle.name,
      kunde: bundle.kunde ?? '',
      vertragsnummer: bundle.vertragsnummer ?? '',
    })
  }

  const close = () => {
    setEditingId(null)
    setCreating(false)
  }

  const handleSave = () => {
    const name = formData.name.trim()
    if (!name) {
      alert('Bundle-Name erforderlich')
      return
    }

    const collision = state.bundles.find(
      b => b.id !== editingId && b.name.trim().toLowerCase() === name.toLowerCase()
    )
    if (collision) {
      alert(`Es gibt bereits ein Bundle "${collision.name}".`)
      return
    }

    const fields = {
      name,
      kunde: formData.kunde.trim() || undefined,
      vertragsnummer: formData.vertragsnummer.trim() || undefined,
    }

    const bundles = editingId
      ? state.bundles.map(b => (b.id === editingId ? { ...b, ...fields } : b))
      : [
          ...state.bundles,
          {
            id: `bundle-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`,
            snapshotIds: [],
            importedAt: new Date(),
            ...fields,
          },
        ]

    onStateUpdate({ ...state, bundles })
    close()
  }

  const handleDelete = (bundle: Bundle) => {
    const projectCount = state.projects.filter(p => p.bundleId === bundle.id).length
    const snapshotCount = bundle.snapshotIds.length

    if (projectCount > 0 || snapshotCount > 0) {
      alert(
        `"${bundle.name}" hat noch ${projectCount} Projekt(e) und ${snapshotCount} Abrechnung(en). ` +
          'Erst diese entfernen, dann lässt sich das Bundle löschen.'
      )
      return
    }

    if (!confirm(`Bundle "${bundle.name}" wirklich löschen?`)) return
    onStateUpdate({ ...state, bundles: state.bundles.filter(b => b.id !== bundle.id) })
  }

  const showForm = creating || editingId !== null

  return (
    <div className="project-editor">
      <div className="project-editor-header">
        <h3>Bundles verwalten</h3>
        <button className="project-btn-primary" onClick={openCreate}>
          ➕ Neues Bundle
        </button>
      </div>

      <p className="project-editor-intro">
        Ein Bundle fasst die Projekte eines Vertrags zusammen. Kunde und Vertragsnummer gehören in
        den Leistungsnachweis — sie lassen sich hier vor dem ersten Import hinterlegen.
      </p>

      {state.bundles.length === 0 ? (
        <p className="project-editor-empty">Noch keine Bundles angelegt.</p>
      ) : (
        <div className="project-editor-table-wrapper">
          <table className="project-editor-table">
            <thead>
              <tr>
                <th>Bundle</th>
                <th>Kunde</th>
                <th>Vertragsnummer</th>
                <th className="project-numeric">Projekte</th>
                <th className="project-numeric">Abrechnungen</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {state.bundles.map(bundle => (
                <tr key={bundle.id}>
                  <td>{bundle.name}</td>
                  <td>{bundle.kunde ?? <span className="project-missing">fehlt</span>}</td>
                  <td>
                    {bundle.vertragsnummer ?? <span className="project-missing">fehlt</span>}
                  </td>
                  <td className="project-numeric">
                    {state.projects.filter(p => p.bundleId === bundle.id).length}
                  </td>
                  <td className="project-numeric">{bundle.snapshotIds.length}</td>
                  <td className="project-actions">
                    <button className="project-btn-edit" onClick={() => openEdit(bundle)}>
                      ✎ Bearbeiten
                    </button>
                    <button className="project-btn-delete" onClick={() => handleDelete(bundle)}>
                      🗑 Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {showForm && (
        <div className="project-editor-modal-overlay" onClick={close}>
          <div className="project-editor-modal" onClick={e => e.stopPropagation()}>
            <h4>{creating ? 'Neues Bundle' : 'Bundle bearbeiten'}</h4>

            <div className="project-editor-form-group">
              <label htmlFor="be-name">Bundle-Name *</label>
              <input
                id="be-name"
                type="text"
                value={formData.name}
                onChange={e => setFormData({ ...formData, name: e.target.value })}
                placeholder="z.B. Muster Bundle"
                autoFocus
              />
            </div>

            <div className="project-editor-form-row">
              <div className="project-editor-form-group">
                <label htmlFor="be-kunde">Kunde</label>
                <input
                  id="be-kunde"
                  type="text"
                  value={formData.kunde}
                  onChange={e => setFormData({ ...formData, kunde: e.target.value })}
                  placeholder="z.B. Muster eG"
                />
              </div>

              <div className="project-editor-form-group">
                <label htmlFor="be-vertrag">Vertragsnummer</label>
                <input
                  id="be-vertrag"
                  type="text"
                  value={formData.vertragsnummer}
                  onChange={e => setFormData({ ...formData, vertragsnummer: e.target.value })}
                />
              </div>
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
