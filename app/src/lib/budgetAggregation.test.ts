import { describe, it, expect } from 'vitest'
import type { ProjectState } from '../types'
import { createEmptyProjectState } from './projectFile'
import {
  createPurchaseOrder,
  poStichtagReport,
  projectBudgetOverview,
  recordInitialConsumption,
  recordLeistungsnachweisConsumption,
  roleBudgetStatus,
  updatePurchaseOrder,
} from './budgetAggregation'

/**
 * Kernszenario aus der Anforderung: eine PO läuft bis 30.09., wird durch eine
 * neue Vertragsnummer verlängert, und Restbudget/Verbrauch der Rolle müssen
 * über den Wechsel hinweg lückenlos bleiben.
 */

function baseState(): ProjectState {
  return {
    ...createEmptyProjectState(),
    projects: [{ id: 'prj-1', bundleId: 'bundle-1', name: 'Atlas' }],
  }
}

const role = { funktion: 'Software Engineer', level: 'Senior' as const, standort: 'Deutschland' as const }

describe('createPurchaseOrder', () => {
  it('lehnt eine bereits vergebene PO-Nummer ab', () => {
    let state = baseState()
    state = createPurchaseOrder(state, {
      poNummer: '4500123456',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-01-01'),
      rollenBudgets: [{ ...role, betrag: 100000 }],
    })
    const before = state
    state = createPurchaseOrder(state, {
      poNummer: '4500123456',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-10-01'),
      rollenBudgets: [{ ...role, betrag: 50000 }],
    })
    expect(state).toBe(before)
  })

  it('löst beim Verlängern die Vorgänger-PO ab, ohne ihre Daten zu verändern', () => {
    let state = baseState()
    state = createPurchaseOrder(state, {
      poNummer: '4500123456',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-01-01'),
      laufzeitEnde: new Date('2026-09-30'),
      rollenBudgets: [{ ...role, betrag: 180000 }],
    })
    const vorgaenger = state.purchaseOrders![0]

    state = createPurchaseOrder(state, {
      poNummer: '4500129981',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-10-01'),
      vorherigePoId: vorgaenger.id,
      rollenBudgets: [{ ...role, betrag: 120000 }],
    })

    const [alt, neu] = state.purchaseOrders!
    expect(alt.status).toBe('abgeloest')
    expect(alt.rollenBudgets[0].betrag).toBe(180000)
    expect(neu.status).toBe('aktiv')
    expect(neu.vorherigePoId).toBe(vorgaenger.id)
  })
})

describe('updatePurchaseOrder', () => {
  it('korrigiert eine falsch angelegte Rolle, ohne Status oder PO-Kette zu verändern', () => {
    let state = baseState()
    state = createPurchaseOrder(state, {
      poNummer: '4500123456',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-01-01'),
      rollenBudgets: [{ funktion: 'Software Engineer', level: 'Junior', standort: 'Deutschland', betrag: 100000 }],
    })
    const po = state.purchaseOrders![0]

    state = updatePurchaseOrder(state, po.id, {
      poNummer: po.poNummer,
      laufzeitStart: po.laufzeitStart,
      laufzeitEnde: po.laufzeitEnde,
      rollenBudgets: [{ ...role, betrag: 100000 }],
    })

    const updated = state.purchaseOrders![0]
    expect(updated.id).toBe(po.id)
    expect(updated.status).toBe('aktiv')
    expect(updated.rollenBudgets[0].level).toBe('Senior')

    const status = roleBudgetStatus(state, 'prj-1', role)
    expect(status.budget).toBe(100000)
  })

  it('lehnt eine PO-Nummer ab, die bereits einer anderen PO gehört', () => {
    let state = baseState()
    state = createPurchaseOrder(state, {
      poNummer: '4500123456',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-01-01'),
      rollenBudgets: [{ ...role, betrag: 100000 }],
    })
    state = createPurchaseOrder(state, {
      poNummer: '4500129981',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-10-01'),
      rollenBudgets: [{ ...role, betrag: 50000 }],
    })
    const [erste, zweite] = state.purchaseOrders!
    const before = state

    state = updatePurchaseOrder(state, zweite.id, {
      poNummer: erste.poNummer,
      laufzeitStart: zweite.laufzeitStart,
      rollenBudgets: zweite.rollenBudgets,
    })

    expect(state).toBe(before)
  })
})

describe('Budget über eine PO-Kette hinweg', () => {
  it('summiert Budget aus beiden POs, Verbrauch bleibt lückenlos über den Wechsel', () => {
    let state = baseState()
    state = createPurchaseOrder(state, {
      poNummer: '4500123456',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-01-01'),
      laufzeitEnde: new Date('2026-09-30'),
      rollenBudgets: [{ ...role, betrag: 180000 }],
    })
    const alt = state.purchaseOrders![0]

    state = recordInitialConsumption(state, {
      projectId: 'prj-1',
      funktion: role.funktion,
      level: role.level,
      standort: role.standort,
      betrag: 150000,
    })

    state = createPurchaseOrder(state, {
      poNummer: '4500129981',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-10-01'),
      vorherigePoId: alt.id,
      rollenBudgets: [{ ...role, betrag: 120000 }],
    })

    const status = roleBudgetStatus(state, 'prj-1', role)
    expect(status.budget).toBe(300000)
    expect(status.verbrauch).toBe(150000)
    expect(status.rest).toBe(150000)
  })

  it('Stichtag zum Laufzeitende der alten PO zeigt nur deren Budget, nicht das der Folge-PO', () => {
    let state = baseState()
    state = createPurchaseOrder(state, {
      poNummer: '4500123456',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-01-01'),
      laufzeitEnde: new Date('2026-09-30'),
      rollenBudgets: [{ ...role, betrag: 180000 }],
    })
    const alt = state.purchaseOrders![0]

    state = recordInitialConsumption(state, {
      projectId: 'prj-1',
      funktion: role.funktion,
      level: role.level,
      standort: role.standort,
      betrag: 150000,
    })

    state = createPurchaseOrder(state, {
      poNummer: '4500129981',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-10-01'),
      vorherigePoId: alt.id,
      rollenBudgets: [{ ...role, betrag: 120000 }],
    })

    const report = poStichtagReport(state, alt.id)
    expect(report?.stichtag).toEqual(new Date('2026-09-30'))
    expect(report?.roles[0].budget).toBe(180000)
    expect(report?.roles[0].verbrauch).toBe(150000)
    expect(report?.roles[0].rest).toBe(30000)
  })

  it('Restbudget der abgelösten PO verfällt nicht, sondern zählt in der Folge-PO weiter', () => {
    let state = baseState()
    state = createPurchaseOrder(state, {
      poNummer: '4500123456',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-01-01'),
      laufzeitEnde: new Date('2026-09-30'),
      rollenBudgets: [{ ...role, betrag: 180000 }],
    })
    const alt = state.purchaseOrders![0]
    state = recordInitialConsumption(state, {
      projectId: 'prj-1',
      funktion: role.funktion,
      level: role.level,
      standort: role.standort,
      betrag: 150000,
    })
    state = createPurchaseOrder(state, {
      poNummer: '4500129981',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-10-01'),
      vorherigePoId: alt.id,
      rollenBudgets: [{ ...role, betrag: 120000 }],
    })

    // Nach dem Wechsel: 30.000 € Rest aus der alten PO stecken weiterhin im Topf.
    const heute = roleBudgetStatus(state, 'prj-1', role, new Date('2026-10-15'))
    expect(heute.budget).toBe(300000)
    expect(heute.rest).toBe(150000)
  })
})

describe('recordInitialConsumption', () => {
  it('legt höchstens einen Initialwert je Rolle an - eine erneute Erfassung korrigiert ihn', () => {
    let state = baseState()
    state = recordInitialConsumption(state, {
      projectId: 'prj-1',
      funktion: role.funktion,
      level: role.level,
      standort: role.standort,
      betrag: 100000,
    })
    state = recordInitialConsumption(state, {
      projectId: 'prj-1',
      funktion: role.funktion,
      level: role.level,
      standort: role.standort,
      betrag: 110000,
    })

    expect(state.budgetConsumption).toHaveLength(1)
    expect(state.budgetConsumption![0].betrag).toBe(110000)
    expect(state.auditLog?.some(e => e.message.includes('korrigiert'))).toBe(true)
  })
})

describe('recordLeistungsnachweisConsumption', () => {
  it('ersetzt bei erneutem Ausführen für denselben Monat statt zu verdoppeln', () => {
    let state = baseState()
    state = recordLeistungsnachweisConsumption(state, 'prj-1', '2027-01', [
      { funktion: role.funktion, level: role.level, standort: role.standort, betrag: 20000, tage: 20 },
    ])
    state = recordLeistungsnachweisConsumption(state, 'prj-1', '2027-01', [
      { funktion: role.funktion, level: role.level, standort: role.standort, betrag: 21000, tage: 21 },
    ])

    const januar = state.budgetConsumption!.filter(e => e.periode === '2027-01')
    expect(januar).toHaveLength(1)
    expect(januar[0].betrag).toBe(21000)
  })
})

describe('projectBudgetOverview', () => {
  it('Gesamtbudget ist konsistent die Summe der Rollenbudgets (Anforderung 3)', () => {
    let state = baseState()
    state = createPurchaseOrder(state, {
      poNummer: '4500123456',
      projectId: 'prj-1',
      laufzeitStart: new Date('2026-01-01'),
      rollenBudgets: [
        { funktion: 'Software Engineer', level: 'Senior', standort: 'Deutschland', betrag: 180000 },
        { funktion: 'Software Engineer', level: 'Expert', standort: 'Deutschland', betrag: 90000 },
      ],
    })

    const overview = projectBudgetOverview(state, 'prj-1')
    const summeRollen = overview.roles.reduce((sum, r) => sum + r.budget, 0)
    expect(overview.gesamtBudget).toBe(summeRollen)
    expect(overview.gesamtBudget).toBe(270000)
  })
})
