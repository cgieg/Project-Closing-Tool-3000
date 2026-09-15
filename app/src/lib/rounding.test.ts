import { describe, it, expect } from 'vitest'
import {
  amountFromDays,
  daysFromHours,
  formatDays,
  formatHours,
  roundHours,
  roundTo,
} from './rounding'

/**
 * Die Rundung ist die schmalste Stelle, an der Geld entsteht: aus ihr kommen die
 * Mengen und Beträge, die auf dem Leistungsnachweis stehen und in der
 * Rechnungsprüfung nachgerechnet werden.
 */
describe('roundTo', () => {
  it('rundet kaufmännisch auf, wo Math.round(x * 10 ** n) danebenliegt', () => {
    // 1.0005 * 1000 ergibt binär 1000.4999999999999 und würde abgerundet.
    // Genau dafür rechnet roundTo über die Exponentialschreibweise.
    expect(roundTo(1.0005, 3)).toBe(1.001)
    expect(roundTo(2.675, 2)).toBe(2.68)
  })

  it('liefert 0 statt NaN, damit keine Zeile mit NaN in die Summe geht', () => {
    expect(roundTo(Number.NaN, 2)).toBe(0)
    expect(roundTo(Number.POSITIVE_INFINITY, 2)).toBe(0)
  })
})

describe('roundHours', () => {
  it('schneidet die Gleitkomma-Reste aus Summen vieler Einzelbuchungen ab', () => {
    expect(roundHours(605.3000000000001)).toBe(605.3)
    expect(roundHours(0.1 + 0.2)).toBe(0.3)
  })
})

describe('daysFromHours', () => {
  it('rechnet acht Stunden auf genau einen Personentag', () => {
    expect(daysFromHours(8)).toBe(1)
    expect(daysFromHours(4)).toBe(0.5)
  })

  it('führt Tage mit drei Nachkommastellen', () => {
    expect(daysFromHours(7.5)).toBe(0.938)
  })

  it('rechnet aus der rohen Stundensumme, nicht aus der gerundeten Anzeige-Stundenzahl', () => {
    // SAP rundet laut Formel =RUNDEN(Summe der Stunden/8;3) die rohe Summe, nicht
    // die bereits auf zwei Nachkommastellen gerundete Anzeige-Stundenzahl. Deshalb
    // weichen hier Stunden- und Tage-Anzeige um eine Nachkommastelle voneinander ab
    // (8,00 Std, aber 1,001 Tage) - das ist beabsichtigt und SAP-konform.
    expect(roundHours(8.004)).toBe(8)
    expect(daysFromHours(8.004)).toBe(1.001)
  })
})

describe('amountFromDays', () => {
  it('multipliziert die bereits gerundete Menge, damit die Zeile nachrechenbar bleibt', () => {
    expect(amountFromDays(0.938, 850)).toBe(797.3)
    expect(amountFromDays(1, 1000)).toBe(1000)
  })

  it('rundet den Betrag auf Cent', () => {
    expect(amountFromDays(0.333, 999)).toBe(332.67)
  })
})

describe('Anzeige', () => {
  it('zeigt Tage immer mit drei und Stunden immer mit zwei Nachkommastellen', () => {
    expect(formatDays(1)).toBe('1,000')
    expect(formatHours(8)).toBe('8,00')
  })
})

describe('Zusammenspiel', () => {
  it('trägt eine Buchung von Stunden bis zum Betrag durch', () => {
    const hours = roundHours(37.5)
    const days = daysFromHours(hours)
    const betrag = amountFromDays(days, 850)

    expect(hours).toBe(37.5)
    expect(days).toBe(4.688)
    expect(betrag).toBe(3984.8)
  })
})
