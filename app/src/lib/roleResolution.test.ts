import { describe, it, expect } from 'vitest'
import { classifyTaskProductivity, isUnproductiveVariant, normalizeProjectName } from './roleResolution'

describe('classifyTaskProductivity', () => {
  it('erkennt die bekannten produktiven Task-Namen aus der August-Fixture', () => {
    expect(classifyTaskProductivity('Atlas - Productive')).toBe('productive')
    expect(classifyTaskProductivity('E-Rechnung - Productive')).toBe('productive')
  })

  it('erkennt Unproductive in mehreren Schreibweisen', () => {
    expect(classifyTaskProductivity('Atlas - Non Productive')).toBe('unproductive')
    expect(classifyTaskProductivity('Atlas - Unproductive')).toBe('unproductive')
    expect(classifyTaskProductivity('Atlas (Non Productive)')).toBe('unproductive')
    expect(classifyTaskProductivity('Atlas Unproduktiv')).toBe('unproductive')
    expect(classifyTaskProductivity('Atlas - nicht produktiv')).toBe('unproductive')
  })

  it('meldet unbekannte Ausprägungen als unklar statt sie stillschweigend abzurechnen', () => {
    expect(classifyTaskProductivity('.Project Management')).toBe('unclear')
    expect(classifyTaskProductivity('')).toBe('unclear')
  })

  it('normalizeProjectName schneidet dieselben Ausprägungen ab wie die Klassifizierung erkennt', () => {
    expect(normalizeProjectName('Atlas - Productive')).toBe('Atlas')
    expect(normalizeProjectName('Atlas - Non Productive')).toBe('Atlas')
    expect(normalizeProjectName('Atlas (Unproductive)')).toBe('Atlas')
  })

  it('isUnproductiveVariant bleibt kompatibel zur bisherigen Verwendung', () => {
    expect(isUnproductiveVariant('Atlas - Non Productive')).toBe(true)
    expect(isUnproductiveVariant('Atlas - Productive')).toBe(false)
  })
})
