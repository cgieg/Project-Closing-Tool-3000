import type { BudgetTrackingMode } from './budget'

export interface Project {
  id: string
  bundleId: string
  name: string
  purchaseOrder?: string
  /**
   * Steuert, ob der Budgetverbrauch von Hand nachgetragen oder automatisch aus
   * Leistungsnachweisen fortgeschrieben wird. Fehlt das Feld, gilt 'manuell'
   * (Rückwärtskompatibilität mit Altbeständen).
   */
  budgetTrackingMode?: BudgetTrackingMode
  /**
   * Weitere Namen, unter denen dieses Projekt im Zeiterfassungs-Export auftaucht.
   *
   * Der Import gleicht über den Namen ab. Die Zeiterfassung liefert aber Bezeichnungen wie
   * "Atlas - Productive", während man das Projekt von Hand als "Atlas" anlegt.
   * Ohne Alias entstünde dabei ein zweites Projekt - mit ihm greift die
   * vorbereitete Zuordnung samt PO und Budget.
   */
  aliases?: string[]
  /**
   * Explizit auf nicht fakturierbar gesetzt - unabhängig von WBS und der
   * Abrechenbar-Kennzeichnung einzelner Zeiteinträge. Fehlt das Feld, gilt das
   * Projekt als fakturierbar (Rückwärtskompatibilität mit Altbeständen).
   */
  fakturierbar?: boolean
}
