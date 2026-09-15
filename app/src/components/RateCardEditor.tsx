import { useState } from 'react'
import type { ProjectState, RateCard } from '../types'
import { STANDORTE, standortKey } from '../types'
import { importSimpleRateCards } from '../lib/simpleRateCardImport'
import { downloadRateCardTemplate } from '../lib/rateCardTemplate'
import { appendAuditLog } from '../lib/auditLog'
import '../styles/RateCardEditor.css'

interface RateCardEditorProps {
  state: ProjectState
  onStateUpdate: (state: ProjectState) => void
}

interface FormData {
  standort: RateCard['standort']
  funktion: string
  level: RateCard['level']
  tagessatz: number
  gueltigVon?: string
  gueltigBis?: string
}


const ROLLEN = [
  'Softwarearchitekt',
  'Product Owner (PO)',
  'Project Management (PMO)',
  'Requirements Engineer',
  'Software Engineer',
  'Scrum Master',
  'Data Scientist',
  'Test Engineer',
] as const

const LEVELS = ['Expert', 'Senior', 'Intermediate', 'Junior'] as const

export function RateCardEditor({ state, onStateUpdate }: RateCardEditorProps) {
  const [showForm, setShowForm] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [importResult, setImportResult] = useState<any>(null)
  const [formData, setFormData] = useState<FormData>({
    standort: 'Deutschland',
    funktion: 'Software Engineer',
    level: 'Senior',
    tagessatz: 0,
  })

  const handleAddClick = () => {
    setEditingId(null)
    setFormData({
      standort: 'Deutschland',
      funktion: 'Software Engineer',
      level: 'Senior',
      tagessatz: 0,
    })
    setShowForm(true)
  }

  const handleEditClick = (card: RateCard) => {
    setEditingId(card.id)
    setFormData({
      standort: card.standort,
      funktion: card.funktion,
      level: card.level,
      tagessatz: card.tagessatz,
      gueltigVon: card.gueltigVon ? new Date(card.gueltigVon).toISOString().split('T')[0] : '',
      gueltigBis: card.gueltigBis ? new Date(card.gueltigBis).toISOString().split('T')[0] : '',
    })
    setShowForm(true)
  }

  const handleSave = () => {
    if (formData.tagessatz <= 0) {
      alert('Bitte gültigen Tagessatz eingeben')
      return
    }

    const newGueltigVon = formData.gueltigVon ? new Date(formData.gueltigVon) : undefined
    const newGueltigBis = formData.gueltigBis ? new Date(formData.gueltigBis) : undefined

    if (editingId) {
      const original = state.rateCards.find(rc => rc.id === editingId)
      const rateChanged = original !== undefined && original.tagessatz !== formData.tagessatz

      if (rateChanged && original) {
        // Fortschreiben statt überschreiben: der alte Tarifzeitraum endet, ein
        // neuer beginnt. Beide Zeilen bleiben stehen - eine bereits eingefrorene
        // Fassung greift ohnehin nur auf ihre eigene Kopie zu, aber ein neuer
        // Abschluss soll den alten Satz nicht rückwirkend verlieren.
        const bis = newGueltigVon
          ? new Date(newGueltigVon.getTime() - 86400000)
          : new Date(Date.now() - 86400000)

        const closedOld: RateCard = { ...original, gueltigBis: original.gueltigBis ?? bis }
        const opened: RateCard = {
          id: Math.random().toString(36).substring(2, 11),
          standort: formData.standort,
          funktion: formData.funktion,
          level: formData.level,
          tagessatz: formData.tagessatz,
          gueltigVon: newGueltigVon ?? new Date(),
          gueltigBis: newGueltigBis,
        }

        onStateUpdate(
          appendAuditLog(
            { ...state, rateCards: state.rateCards.map(rc => (rc.id === editingId ? closedOld : rc)).concat(opened) },
            'change',
            `Rate Card fortgeschrieben: ${formData.level} ${formData.funktion} (${formData.standort}) ` +
              `${original.tagessatz.toFixed(2)} € → ${formData.tagessatz.toFixed(2)} €`,
          ),
        )
      } else {
        const updated = state.rateCards.map(rc =>
          rc.id === editingId
            ? {
                ...rc,
                standort: formData.standort,
                funktion: formData.funktion,
                level: formData.level,
                tagessatz: formData.tagessatz,
                gueltigVon: newGueltigVon,
                gueltigBis: newGueltigBis,
              }
            : rc
        )
        onStateUpdate(
          appendAuditLog(
            { ...state, rateCards: updated },
            'change',
            `Rate Card bearbeitet: ${formData.level} ${formData.funktion} (${formData.standort})`,
          ),
        )
      }
    } else {
      const newCard: RateCard = {
        id: Math.random().toString(36).substring(2, 11),
        standort: formData.standort,
        funktion: formData.funktion,
        level: formData.level,
        tagessatz: formData.tagessatz,
        gueltigVon: newGueltigVon,
        gueltigBis: newGueltigBis,
      }
      onStateUpdate(
        appendAuditLog(
          { ...state, rateCards: [...state.rateCards, newCard] },
          'change',
          `Rate Card angelegt: ${formData.level} ${formData.funktion} (${formData.standort}), ${formData.tagessatz.toFixed(2)} €`,
        ),
      )
    }

    setShowForm(false)
  }

  const handleDelete = (id: string) => {
    if (confirm('Rate Card wirklich löschen?')) {
      onStateUpdate({
        ...state,
        rateCards: state.rateCards.filter(rc => rc.id !== id),
      })
    }
  }

  const handleImportConfirm = () => {
    if (importResult?.rateCards?.length > 0) {
      // Add rate cards
      let updatedState = {
        ...state,
        rateCards: [...state.rateCards, ...importResult.rateCards],
      }

      // Add roles if any were created
      if (importResult.rolesToCreate?.length > 0) {
        updatedState = {
          ...updatedState,
          roles: [...state.roles, ...importResult.rolesToCreate],
        }
      }

      onStateUpdate(updatedState)
      setShowImport(false)
      setImportResult(null)
    }
  }

  const handleExcelFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0]
    if (!file) return

    const result = await importSimpleRateCards(file)
    setImportResult(result)
  }

  const sortedCards = [...state.rateCards].sort((a, b) => {
    if (a.standort !== b.standort) return a.standort.localeCompare(b.standort)
    if (a.funktion !== b.funktion) return a.funktion.localeCompare(b.funktion)
    return LEVELS.indexOf(a.level) - LEVELS.indexOf(b.level)
  })

  return (
    <section className="rate-card-editor">
      <div className="rce-header">
        <h2>Rate Cards verwalten</h2>
        <div className="rce-header-buttons">
          <button className="rce-btn-secondary" onClick={() => downloadRateCardTemplate()}>
            📥 Vorlage herunterladen
          </button>
          <button className="rce-btn-secondary" onClick={() => setShowImport(true)}>
            📋 Importieren
          </button>
          <button className="rce-btn-primary" onClick={handleAddClick}>
            ➕ Neue Rate Card
          </button>
        </div>
      </div>

      {state.rateCards.length === 0 ? (
        <div className="rce-empty">
          <p>Keine Rate Cards definiert. Lade die Vorlage herunter und importiere deine Tarife!</p>
        </div>
      ) : (
        <div className="rce-table-container">
          <table className="rce-table">
            <thead>
              <tr>
                <th>Standort</th>
                <th>Rolle</th>
                <th>Level</th>
                <th className="rce-numeric">Tagessatz (EUR)</th>
                <th>Gültig von</th>
                <th>Gültig bis</th>
                <th>Aktionen</th>
              </tr>
            </thead>
            <tbody>
              {sortedCards.map(card => (
                <tr key={card.id}>
                  <td>
                    <span className={`rce-standort rce-standort-${standortKey(card.standort)}`}>
                      {card.standort}
                    </span>
                  </td>
                  <td><strong>{card.funktion}</strong></td>
                  <td>
                    <span className={`rce-level rce-level-${card.level.toLowerCase()}`}>
                      {card.level}
                    </span>
                  </td>
                  <td className="rce-numeric">{card.tagessatz.toFixed(2)}</td>
                  <td>{card.gueltigVon ? new Date(card.gueltigVon).toLocaleDateString('de-DE') : '-'}</td>
                  <td>{card.gueltigBis ? new Date(card.gueltigBis).toLocaleDateString('de-DE') : '-'}</td>
                  <td className="rce-actions">
                    <button className="rce-btn-edit" onClick={() => handleEditClick(card)}>
                      ✎ Bearbeiten
                    </button>
                    <button className="rce-btn-delete" onClick={() => handleDelete(card.id)}>
                      🗑 Löschen
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Import Modal */}
      {showImport && (
        <div className="rce-modal-overlay" onClick={() => !importResult && setShowImport(false)}>
          <div className="rce-modal rce-modal-large" onClick={e => e.stopPropagation()}>
            <h3>Rate Cards importieren</h3>

            {!importResult ? (
              <>
                <div className="rce-import-instruction">
                  <p>Wähle eine Excel-Datei mit Rate Cards aus:</p>
                  <small>Verwende die Vorlage: Rolle | Level | Tagessatz</small>
                </div>

                <div className="rce-file-input-wrapper">
                  <input
                    type="file"
                    id="rate-card-file"
                    accept=".xlsx,.xls"
                    onChange={handleExcelFileUpload}
                    className="rce-file-input"
                  />
                  <label htmlFor="rate-card-file" className="rce-file-input-label">
                    📁 Excel-Datei auswählen
                  </label>
                </div>

                <div className="rce-modal-actions">
                  <button className="rce-btn-secondary" onClick={() => {
                    setShowImport(false)
                  }}>
                    Abbrechen
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="rce-import-result">
                  {importResult.success && (
                    <div className="rce-result-success">
                      ✓ {importResult.rateCards.length} Rate Card(s) gefunden
                      {importResult.rolesToCreate.length > 0 && ` + ${importResult.rolesToCreate.length} neue Rolle(n)`}
                    </div>
                  )}

                  {importResult.errors.length > 0 && (
                    <div className="rce-result-errors">
                      <strong>❌ Fehler:</strong>
                      <ul>
                        {importResult.errors.slice(0, 5).map((err: any, i: number) => (
                          <li key={i}>Zeile {err.row}: {err.message}</li>
                        ))}
                        {importResult.errors.length > 5 && (
                          <li>... und {importResult.errors.length - 5} weitere Fehler</li>
                        )}
                      </ul>
                    </div>
                  )}

                  {importResult.warnings.length > 0 && (
                    <div className="rce-result-warnings">
                      <strong>⚠️ Warnungen:</strong>
                      <ul>
                        {importResult.warnings.slice(0, 3).map((warn: any, i: number) => (
                          <li key={i}>Zeile {warn.row}: {warn.message}</li>
                        ))}
                        {importResult.warnings.length > 3 && (
                          <li>... und {importResult.warnings.length - 3} weitere</li>
                        )}
                      </ul>
                    </div>
                  )}

                  {importResult.rateCards.length > 0 && (
                    <div className="rce-import-preview">
                      <strong>📊 Vorschau ({importResult.rateCards.length} Einträge):</strong>
                      <div className="rce-preview-table">
                        {importResult.rateCards.slice(0, 5).map((card: RateCard, i: number) => (
                          <div key={i} className="rce-preview-row">
                            {card.funktion} | {card.level} | €{card.tagessatz.toFixed(2)}
                          </div>
                        ))}
                        {importResult.rateCards.length > 5 && (
                          <div className="rce-preview-row">... und {importResult.rateCards.length - 5} weitere</div>
                        )}
                      </div>
                    </div>
                  )}
                </div>

                <div className="rce-modal-actions">
                  <button
                    className="rce-btn-secondary"
                    onClick={() => {
                      setImportResult(null)
                    }}
                  >
                    Zurück
                  </button>
                  <button
                    className="rce-btn-primary"
                    onClick={handleImportConfirm}
                    disabled={!importResult.success || importResult.rateCards.length === 0}
                  >
                    Importieren ({importResult.rateCards?.length || 0})
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Form Modal */}
      {showForm && (
        <div className="rce-modal-overlay" onClick={() => setShowForm(false)}>
          <div className="rce-modal" onClick={e => e.stopPropagation()}>
            <h3>{editingId ? 'Rate Card bearbeiten' : 'Neue Rate Card'}</h3>

            <div className="rce-form-row">
              <div className="rce-form-group">
                <label>Standort *</label>
                <select
                  value={formData.standort}
                  onChange={e => setFormData({ ...formData, standort: e.target.value as RateCard['standort'] })}
                >
                  {STANDORTE.map(standort => (
                    <option key={standort} value={standort}>
                      {standort}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rce-form-group">
                <label>Rolle *</label>
                <select
                  value={formData.funktion}
                  onChange={e => setFormData({ ...formData, funktion: e.target.value })}
                >
                  {ROLLEN.map(rolle => (
                    <option key={rolle} value={rolle}>
                      {rolle}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="rce-form-row">
              <div className="rce-form-group">
                <label>Level *</label>
                <select
                  value={formData.level}
                  onChange={e => setFormData({ ...formData, level: e.target.value as RateCard['level'] })}
                >
                  {LEVELS.map(level => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </div>

              <div className="rce-form-group">
                <label>Tagessatz (EUR) *</label>
                <input
                  type="number"
                  step="0.01"
                  value={formData.tagessatz}
                  onChange={e => setFormData({ ...formData, tagessatz: parseFloat(e.target.value) || 0 })}
                />
              </div>
            </div>

            <div className="rce-form-row">
              <div className="rce-form-group">
                <label>Gültig von</label>
                <input
                  type="date"
                  value={formData.gueltigVon || ''}
                  onChange={e => setFormData({ ...formData, gueltigVon: e.target.value })}
                />
              </div>

              <div className="rce-form-group">
                <label>Gültig bis</label>
                <input
                  type="date"
                  value={formData.gueltigBis || ''}
                  onChange={e => setFormData({ ...formData, gueltigBis: e.target.value })}
                />
              </div>
            </div>

            <div className="rce-modal-actions">
              <button className="rce-btn-secondary" onClick={() => setShowForm(false)}>
                Abbrechen
              </button>
              <button className="rce-btn-primary" onClick={handleSave}>
                Speichern
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
