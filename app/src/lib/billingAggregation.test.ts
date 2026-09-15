import { describe, it, expect } from 'vitest'
import type { Employee, Project, ProjectResourceAssignment, RateCard, TimeEntry } from '../types'
import { aggregateEntries, entryMonth, summarizeNonChargeable } from './billingAggregation'

/**
 * Die gemeinsame Aggregation speist Abrechnung, Bundle-Übersicht und Dashboard.
 * Läuft sie auseinander, zeigen zwei Ansichten für dieselben Daten verschiedene
 * Zahlen - genau das soll sie verhindern.
 */

const employees: Employee[] = [
  {
    id: 'emp-1',
    personalnummer: '30000001',
    name: 'MUSTER, Anna',
    active: true,
  },
  {
    id: 'emp-2',
    personalnummer: '30000002',
    name: 'BEISPIEL, Jan',
    active: true,
  },
  {
    id: 'emp-3',
    personalnummer: '30000003',
    name: 'OFFEN, Ohne Rolle',
    active: true,
  },
]

/** Rolle kommt ausschließlich aus der Projekt-Zuordnung - Standardfall in den meisten Tests. */
const standardAssignments: ProjectResourceAssignment[] = [
  {
    id: 'pa-emp1',
    projectId: 'prj-1',
    employeeId: 'emp-1',
    employeeName: 'MUSTER, Anna',
    funktion: 'Software Engineer',
    level: 'Senior',
    standort: 'Deutschland',
  },
  {
    id: 'pa-emp2',
    projectId: 'prj-1',
    employeeId: 'emp-2',
    employeeName: 'BEISPIEL, Jan',
    funktion: 'Software Engineer',
    level: 'Senior',
    standort: 'Deutschland',
  },
]

const rateCards: RateCard[] = [
  {
    id: 'rc-de-senior',
    standort: 'Deutschland',
    funktion: 'Software Engineer',
    level: 'Senior',
    tagessatz: 800,
  },
  {
    id: 'rc-ro-senior',
    standort: 'Rumänien',
    funktion: 'Software Engineer',
    level: 'Senior',
    tagessatz: 450,
  },
]

const projects: Project[] = [
  { id: 'prj-1', bundleId: 'bnd-1', name: 'Atlas' },
  { id: 'prj-2', bundleId: 'bnd-1', name: 'Interne Arbeit', fakturierbar: false },
]

function entry(overrides: Partial<TimeEntry> = {}): TimeEntry {
  return {
    id: `te-${Math.random().toString(36).slice(2)}`,
    wbsNumber: '2.1.1',
    parentPath: 'Muster \\ Atlas',
    task: 'Atlas - Productive',
    resource: 'MUSTER, Anna',
    date: new Date(2026, 7, 12),
    effortHours: 8,
    status: 'approved',
    isProductive: true,
    projectName: 'Atlas',
    chargeable: true,
    ...overrides,
  }
}

const baseState = { projects, rateCards, projectAssignments: standardAssignments }

describe('aggregateEntries', () => {
  it('verdichtet nach Rolle, nicht nach Person', () => {
    const result = aggregateEntries(
      [entry({ resource: 'MUSTER, Anna' }), entry({ resource: 'BEISPIEL, Jan' })],
      employees,
      baseState,
    )

    expect(result.lines).toHaveLength(1)
    expect(result.lines[0].roleLabel).toBe('Senior Software Engineer (Deutschland)')
    expect(result.lines[0].hours).toBe(16)
    expect(result.lines[0].days).toBe(2)
    expect(result.lines[0].betrag).toBe(1600)
  })

  it('rechnet Stunden über Tage in den Betrag', () => {
    const result = aggregateEntries([entry({ effortHours: 7.5 })], employees, baseState)

    expect(result.lines[0].hours).toBe(7.5)
    expect(result.lines[0].days).toBe(0.938)
    expect(result.lines[0].betrag).toBe(750.4)
  })

  it('meldet eine fehlende Rate Card, statt still einen anderen Satz zu nehmen', () => {
    const nearshore: ProjectResourceAssignment[] = [
      { ...standardAssignments[0], standort: 'Polen' },
    ]

    const result = aggregateEntries([entry()], employees, { ...baseState, projectAssignments: nearshore })

    expect(result.lines[0].hasRateCard).toBe(false)
    expect(result.lines[0].tagessatz).toBe(0)
    expect(result.lines[0].betrag).toBe(0)
    expect(result.missingRateCards).toEqual(['Senior Software Engineer (Polen)'])
  })

  it('meldet unbekannte Mitarbeiter, statt ihre Stunden zu verschlucken', () => {
    const result = aggregateEntries([entry({ resource: 'FREMD, Person' })], employees, baseState)

    expect(result.lines).toHaveLength(0)
    expect(result.missingEmployees).toEqual(['FREMD, Person'])
  })

  it('rechnet ein nicht fakturierbares Projekt nicht ab, auch wenn die Zeile abrechenbar ist', () => {
    const result = aggregateEntries(
      [entry({ projectName: 'Interne Arbeit', chargeable: true })],
      employees,
      baseState,
    )

    expect(result.lines).toHaveLength(0)
  })

  it('löst die Rolle über die Projektzuordnung auf, inklusive abweichendem Standort', () => {
    const assignments: ProjectResourceAssignment[] = [
      {
        id: 'pa-1',
        projectId: 'prj-1',
        employeeId: 'emp-1',
        employeeName: 'MUSTER, Anna',
        funktion: 'Software Engineer',
        level: 'Senior',
        standort: 'Rumänien',
      },
    ]

    const result = aggregateEntries([entry()], employees, { ...baseState, projectAssignments: assignments })

    expect(result.lines[0].standort).toBe('Rumänien')
    expect(result.lines[0].tagessatz).toBe(450)
    expect(result.lines[0].fromProjectAssignment).toBe(true)
  })

  it('führt einen Mitarbeiter ohne Projektzuordnung als offene Rolle ohne Tagessatz', () => {
    const result = aggregateEntries([entry({ resource: 'OFFEN, Ohne Rolle' })], employees, baseState)

    expect(result.lines[0].funktion).toBe('')
    expect(result.lines[0].hasRateCard).toBe(false)
    expect(result.lines[0].betrag).toBe(0)
  })
})

describe('summarizeNonChargeable', () => {
  it('fasst die geleisteten, aber nicht berechneten Stunden nach Tätigkeit zusammen', () => {
    const entries = [
      entry({ chargeable: false, taskType: 'PM', effortHours: 4 }),
      entry({ chargeable: false, taskType: 'PM', effortHours: 2.5 }),
      entry({ chargeable: false, taskType: 'Training', effortHours: 8 }),
      entry({ chargeable: true, effortHours: 8 }),
    ]

    const summary = summarizeNonChargeable(entries)

    expect(summary.hours).toBe(14.5)
    expect(summary.byTaskType).toEqual([
      { taskType: 'Training', hours: 8 },
      { taskType: 'PM', hours: 6.5 },
    ])
  })

  it('zählt alles zum nicht Berechneten, wenn das Projekt nicht fakturierbar ist', () => {
    const summary = summarizeNonChargeable([entry({ effortHours: 8 })], { fakturierbar: false })

    expect(summary.hours).toBe(8)
  })
})

describe('entryMonth', () => {
  it('liefert den Monat als YYYY-MM', () => {
    expect(entryMonth({ date: new Date(2026, 7, 12) })).toBe('2026-08')
  })

  it('überlebt den JSON-Roundtrip, in dem aus Date ein String wird', () => {
    expect(entryMonth({ date: '2026-08-12T00:00:00.000Z' as unknown as Date })).toBe('2026-08')
  })

  it('liefert einen leeren Monat statt einer Ausnahme, wenn das Datum unbrauchbar ist', () => {
    expect(entryMonth({ date: 'kein Datum' as unknown as Date })).toBe('')
  })
})
