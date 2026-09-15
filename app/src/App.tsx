import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectState } from './types'
import { autoSaveState, flushPendingSave, loadState } from './lib/persistence'
import { unresolvedAcrossSnapshots } from './lib/billingAggregation'
import { FileBar } from './components/FileBar'
import { ImportPanel } from './components/ImportPanel'
import { RateCardEditor } from './components/RateCardEditor'
import { ProjectList } from './components/ProjectList'
import { ProjectDetail } from './components/ProjectDetail'
import { BundleUebersicht } from './components/BundleUebersicht'
import { DataManagement } from './components/DataManagement'
import { Dashboard } from './components/Dashboard'
import { ProjectRoleAssignmentManager } from './components/ProjectRoleAssignmentManager'
import { BudgetManager } from './components/BudgetManager'
import { APP_VERSION } from './lib/buildVersion'
import './App.css'

const initialState: ProjectState = {
  schemaVersion: '1.0.0',
  appVersion: '0.1.0',
  currentSnapshotId: '',
  snapshots: [],
  rateCards: [],
  roles: [],
  employees: [],
  bundles: [],
  projects: [],
  timeEntries: [],
  projectAssignments: [],
  purchaseOrders: [],
  budgetConsumption: [],
}

function App() {
  const [state, setState] = useState<ProjectState>(initialState)
  const [activeTab, setActiveTab] = useState<'import' | 'rateCards' | 'roles' | 'budget' | 'dashboard' | 'results' | 'bundle' | 'data'>('dashboard')

  // IndexedDB laedt asynchron. Bis der letzte Stand da ist, darf nichts
  // zurueckgeschrieben werden - sonst ueberschreibt der leere Startzustand die Daten.
  const [hydrated, setHydrated] = useState(false)
  // Aenderungen seit dem letzten Schreiben in die Datei
  const [dirty, setDirty] = useState(false)
  const stateRef = useRef(state)
  stateRef.current = state

  useEffect(() => {
    let cancelled = false

    void loadState().then(stored => {
      if (cancelled) return
      if (stored) setState(stored)
      setHydrated(true)
    })

    return () => {
      cancelled = true
    }
  }, [])

  // Arbeitsstand entprellt in IndexedDB sichern
  useEffect(() => {
    if (!hydrated) return
    autoSaveState(state)
  }, [state, hydrated])

  // Beim Verlassen sichern und vor ungesicherten Dateiaenderungen warnen.
  //
  // visibilitychange ist der zuverlaessige Zeitpunkt: bei beforeunload bleibt fuer
  // den asynchronen IndexedDB-Schreibvorgang oft keine Zeit mehr.
  useEffect(() => {
    const saveNow = () => {
      if (hydrated) void flushPendingSave(stateRef.current)
    }

    const handleVisibility = () => {
      if (document.visibilityState === 'hidden') saveNow()
    }

    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      saveNow()
      if (dirty) {
        event.preventDefault()
        event.returnValue = ''
      }
    }

    document.addEventListener('visibilitychange', handleVisibility)
    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility)
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [dirty, hydrated])

  // Jede Zustandsaenderung markiert die Datei als veraltet
  const updateState = useCallback((next: ProjectState) => {
    setState(next)
    setDirty(true)
  }, [])

  const replaceState = useCallback((next: ProjectState) => {
    setState(next)
    setDirty(false)
  }, [])

  const unresolvedRoleCount = useMemo(() => unresolvedAcrossSnapshots(state).length, [state])

  if (!hydrated) {
    return (
      <div className="app app-loading">
        <p>Arbeitsstand wird geladen…</p>
      </div>
    )
  }

  return (
    <div className="app">
      <header className="app-header">
        <div className="app-header-logo">
          <div>
            <h1>
              Closing Tool <span className="app-version-badge">v{APP_VERSION}</span>
            </h1>
            <p>Single-Bundle-Kostenrechnung und Leistungsnachweis-Generator</p>
          </div>
        </div>
      </header>

      <nav className="app-nav">
        <button
          className={activeTab === 'dashboard' ? 'active' : ''}
          onClick={() => setActiveTab('dashboard')}
        >
          📈 Dashboard
        </button>
        <button
          className={activeTab === 'import' ? 'active' : ''}
          onClick={() => setActiveTab('import')}
        >
          📥 Import
        </button>
        <button
          className={activeTab === 'rateCards' ? 'active' : ''}
          onClick={() => setActiveTab('rateCards')}
        >
          💰 Rate Cards
        </button>
        <button
          className={activeTab === 'roles' ? 'active' : ''}
          onClick={() => setActiveTab('roles')}
        >
          🎯 Projekt-Rollen
          {unresolvedRoleCount > 0 && (
            <span
              style={{
                marginLeft: 6,
                background: '#B3261E',
                color: '#fff',
                borderRadius: 10,
                padding: '0 7px',
                fontSize: '0.75em',
              }}
              title={`${unresolvedRoleCount} Zuordnung(en) ohne Rolle`}
            >
              {unresolvedRoleCount}
            </span>
          )}
        </button>
        <button
          className={activeTab === 'budget' ? 'active' : ''}
          onClick={() => setActiveTab('budget')}
        >
          💶 Budget
        </button>
        <button
          className={activeTab === 'results' ? 'active' : ''}
          onClick={() => setActiveTab('results')}
        >
          📊 Ergebnisse
        </button>
        <button
          className={activeTab === 'bundle' ? 'active' : ''}
          onClick={() => setActiveTab('bundle')}
        >
          📦 Bundle
        </button>
        <button
          className={activeTab === 'data' ? 'active' : ''}
          onClick={() => setActiveTab('data')}
        >
          💾 Daten
        </button>
      </nav>

      <FileBar
        state={state}
        dirty={dirty}
        onStateReplace={replaceState}
        onSaved={() => setDirty(false)}
      />

      <main className="app-main">
        {activeTab === 'dashboard' && (
          <Dashboard state={state} />
        )}

        {activeTab === 'import' && (
          <ImportPanel state={state} onStateUpdate={updateState} />
        )}

        {activeTab === 'rateCards' && (
          <RateCardEditor state={state} onStateUpdate={updateState} />
        )}

        {activeTab === 'roles' && (
          <ProjectRoleAssignmentManager state={state} onStateUpdate={updateState} />
        )}

        {activeTab === 'budget' && (
          <BudgetManager state={state} onStateUpdate={updateState} />
        )}

        {activeTab === 'results' && state.currentSnapshotId ? (
          <ProjectDetail
            state={state}
            snapshotId={state.currentSnapshotId}
            onStateUpdate={updateState}
            onBack={() => setState(prev => ({ ...prev, currentSnapshotId: '' }))}
            onNavigateToRoles={() => setActiveTab('roles')}
          />
        ) : activeTab === 'results' ? (
          <ProjectList
            state={state}
            onStateUpdate={updateState}
            onSelectSnapshot={(snapshotId) => {
              setState(prev => ({ ...prev, currentSnapshotId: snapshotId }))
            }}
          />
        ) : null}

        {activeTab === 'bundle' && (
          <BundleUebersicht state={state} onStateUpdate={updateState} />
        )}

        {activeTab === 'data' && (
          <DataManagement state={state} onStateUpdate={updateState} />
        )}
      </main>

      <footer className="app-footer">
        <p>
          Closing Tool v{APP_VERSION}
        </p>
      </footer>
    </div>
  )
}

export default App
