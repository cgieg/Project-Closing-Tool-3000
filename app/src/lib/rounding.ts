/**
 * Rundung nach SAP-Logik.
 *
 * Einzige Quelle für die Umrechnung Stunden -> Tage und für die Betragsbildung.
 * Vorher lag beides an sieben Stellen verstreut, mit einer bis drei
 * Nachkommastellen - dieselbe Abrechnung konnte je nach Ansicht abweichen.
 */

/** Nachkommastellen der Abrechnungsmenge in Tagen. */
export const DAY_DECIMALS = 3

/** Nachkommastellen der erfassten Stunden. */
export const HOUR_DECIMALS = 2

/** Ein Personentag entspricht acht Stunden. */
export const HOURS_PER_DAY = 8

/**
 * Erfasste Stunden auf zwei Nachkommastellen.
 *
 * Summen aus vielen Einzelbuchungen tragen sonst Gleitkomma-Reste mit sich -
 * 605.3000000000001 statt 605.30.
 */
export function roundHours(hours: number): number {
  return roundTo(hours, HOUR_DECIMALS)
}

/**
 * Stunden in Abrechnungstage, auf drei Nachkommastellen gerundet.
 *
 * Formel: =RUNDEN(Summe der Stunden/8;3)
 * Kaufmännisch über die Exponentialschreibweise, weil `Math.round(x * 1000)` bei
 * Werten wie 1.0005 durch die binäre Gleitkommadarstellung danebenliegt.
 */
export function daysFromHours(hours: number): number {
  return roundTo(hours / HOURS_PER_DAY, DAY_DECIMALS)
}

/**
 * Betrag aus Tagen und Tagessatz.
 *
 * Multipliziert bewusst mit der bereits gerundeten Menge: SAP führt die Menge mit
 * drei Nachkommastellen, und der Beleg muss nachrechenbar bleiben. Aus der
 * ungerundeten Menge zu rechnen ergäbe Zeilen, die sich nicht ausmultiplizieren
 * lassen - genau das fällt in der Rechnungsprüfung auf.
 */
export function amountFromDays(days: number, tagessatz: number): number {
  return roundTo(days * tagessatz, 2)
}

/** Kaufmännisch runden, ohne die Gleitkomma-Fallen von `Math.round(x * 10 ** n)`. */
export function roundTo(value: number, decimals: number): number {
  if (!Number.isFinite(value)) return 0
  const shifted = Number(`${value}e${decimals}`)
  if (!Number.isFinite(shifted)) return value
  return Number(`${Math.round(shifted)}e-${decimals}`)
}

/** Tage für die Anzeige - immer mit drei Nachkommastellen. */
export function formatDays(days: number): string {
  return days.toLocaleString('de-DE', {
    minimumFractionDigits: DAY_DECIMALS,
    maximumFractionDigits: DAY_DECIMALS,
  })
}

/** Stunden für die Anzeige - immer mit zwei Nachkommastellen. */
export function formatHours(hours: number): string {
  return hours.toLocaleString('de-DE', {
    minimumFractionDigits: HOUR_DECIMALS,
    maximumFractionDigits: HOUR_DECIMALS,
  })
}

/** Euro-Beträge für die Anzeige - immer mit zwei Nachkommastellen. */
export function formatAmount(amount: number): string {
  return amount.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}
