import { describe, it, expect } from 'vitest'
import { utils, write } from 'xlsx'
import { importTimesheetExcel } from './timesheetImport'

/**
 * Der Import ist die einzige Stelle, an der fremde Daten hereinkommen. Geprüft
 * wird an einer im Test gebauten Mappe statt an der echten Exportdatei: die ist
 * 13 MB gross, enthaelt personenbezogene Daten und liegt ausserhalb des Projekts.
 *
 * Spaltenordnung wie im Zeiterfassungs-Export; Zeile 0 ist Formatierung, Zeile 1 die
 * Kopfzeile, ab Zeile 2 stehen Daten.
 */

/** Spaltenindizes des Zeiterfassungs-Exports - Bezeichner statt Zahlen in den Testfaellen. */
const COL = {
  WBS_NUMBER: 1,
  TASK: 3,
  RESOURCE: 6,
  EFFORT: 8,
  TIME_ID: 10,
} as const

const HEADER: string[] = [
  'WBSOrder', 'WBSNumber', 'Parents', 'Task', 'TaskType', 'FixedFee',
  'Resource', 'Date', 'Effort', 'Status', 'TimeId', 'Comment',
]

/** 12.08.2026 als Excel-Seriendatum (Tage seit 1899-12-30). */
const DATE_2026_08_12 = 46246

/** Eine gueltige Datenzeile; ueberschrieben wird ueber den Spaltenindex. */
function row(overrides: Record<number, unknown> = {}): unknown[] {
  const base: unknown[] = [
    '1', '2.1.1', 'Muster \\ Atlas \\', 'Atlas - Productive', '', '',
    'MUSTER, Anna - 30000001', DATE_2026_08_12, 8, 'A', '{time-1}', '',
  ]
  Object.entries(overrides).forEach(([index, value]) => {
    base[Number(index)] = value
  })
  return base
}

function excelFile(dataRows: unknown[][], name = 'test.xlsx'): File {
  // Zeile 0 braucht echten Inhalt: eine leere Zeile erzeugt keine Zellen und
  // der Bereich der Mappe begaenne erst bei der Kopfzeile - dann verschoebe sich
  // alles um eine Zeile und die erste Datenzeile fiele weg.
  const sheet = utils.aoa_to_sheet([['Export'], HEADER, ...dataRows])
  const book = utils.book_new()
  utils.book_append_sheet(book, sheet, 'SMART Export')
  const buffer = write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([buffer], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

/**
 * Wie excelFile, aber ohne die Formatierungszeile davor - also mit genau einer
 * Kopfzeile, so wie der echte Zeiterfassungs-Export aufgebaut ist.
 */
function excelFileSingleHeader(dataRows: unknown[][], name = 'einzelne-kopfzeile.xlsx'): File {
  const sheet = utils.aoa_to_sheet([HEADER, ...dataRows])
  const book = utils.book_new()
  utils.book_append_sheet(book, sheet, 'SMART Export')
  const buffer = write(book, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer
  return new File([buffer], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
}

describe('importTimesheetExcel', () => {
  it('liest eine Zeile mit allen geforderten Feldern', async () => {
    const result = await importTimesheetExcel(excelFile([row()]))

    expect(result.success).toBe(true)
    expect(result.errors).toHaveLength(0)
    expect(result.timeEntries).toHaveLength(1)

    const entry = result.timeEntries[0]
    expect(entry.timeId).toBe('{time-1}')
    expect(entry.wbsNumber).toBe('2.1.1')
    expect(entry.resource).toBe('MUSTER, Anna')
    expect(entry.effortHours).toBe(8)
    expect(entry.date.getFullYear()).toBe(2026)
    expect(entry.date.getMonth()).toBe(7)
  })

  it('schneidet die Ausprägung vom Projektnamen ab', async () => {
    const result = await importTimesheetExcel(
      excelFile([
        row({ [COL.TASK]: 'Atlas - Productive', [COL.TIME_ID]: '{a}' }),
        row({ [COL.WBS_NUMBER]: '1.2.1', [COL.TASK]: 'Atlas - Non Productive', [COL.TIME_ID]: '{b}' }),
      ]),
    )

    expect(result.timeEntries.map(e => e.projectName)).toEqual(['Atlas', 'Atlas'])
  })

  it('rechnet WBS 2.x ab und WBS 1.x nicht', async () => {
    const result = await importTimesheetExcel(
      excelFile([
        row({ [COL.WBS_NUMBER]: '2.1.1', [COL.TIME_ID]: '{produktiv}' }),
        row({ [COL.WBS_NUMBER]: '1.3.1', [COL.TASK]: '.Project Management', [COL.TIME_ID]: '{overhead}' }),
      ]),
    )

    const [produktiv, overhead] = result.timeEntries
    expect(produktiv.isProductive).toBe(true)
    expect(produktiv.chargeable).toBe(true)
    expect(overhead.isProductive).toBe(false)
    expect(overhead.chargeable).toBe(false)
  })

  it('rechnet eine Unproductive-Zeile auf WBS 2.x nicht ab', async () => {
    // Zwei Signale: ohne die Prüfung des Task-Namens ginge diese Zeile allein
    // wegen ihrer WBS-Nummer auf die Rechnung.
    const result = await importTimesheetExcel(
      excelFile([row({ [COL.WBS_NUMBER]: '2.1.1', [COL.TASK]: 'Atlas - Unproductive', [COL.TIME_ID]: '{unprod}' })]),
    )

    expect(result.timeEntries[0].isProductive).toBe(false)
    expect(result.timeEntries[0].chargeable).toBe(false)
    expect(result.stats.unclearProductivity).toBe(0)
  })

  it('meldet eine unbekannte Ausprägung auf WBS 2.x, statt sie still abzurechnen', async () => {
    const result = await importTimesheetExcel(
      excelFile([row({ [COL.WBS_NUMBER]: '2.1.1', [COL.TASK]: 'Atlas - Sonderthema', [COL.TIME_ID]: '{unklar}' })]),
    )

    expect(result.stats.unclearProductivity).toBe(1)
    expect(result.warnings.some(w => w.field === 'TASK')).toBe(true)
  })

  it('weist eine TimeId ab, die in derselben Datei schon vorkam', async () => {
    const result = await importTimesheetExcel(
      excelFile([row({ [COL.TIME_ID]: '{doppelt}' }), row({ [COL.TIME_ID]: '{doppelt}' })]),
    )

    expect(result.timeEntries).toHaveLength(1)
    expect(result.stats.duplicatesInFile).toBe(1)
  })

  it('weist eine TimeId ab, die bereits in einer früheren Abrechnung steckt', async () => {
    const result = await importTimesheetExcel(excelFile([row({ [COL.TIME_ID]: '{schon-da}' })]), {
      knownTimeIds: new Set(['{schon-da}']),
    })

    expect(result.timeEntries).toHaveLength(0)
    expect(result.stats.alreadyImported).toBe(1)
    expect(result.success).toBe(false)
  })

  it('übernimmt eine Zeile ohne TimeId und weist auf den fehlenden Dublettenschutz hin', async () => {
    const result = await importTimesheetExcel(excelFile([row({ [COL.TIME_ID]: '' })]))

    expect(result.timeEntries).toHaveLength(1)
    expect(result.timeEntries[0].timeId).toBeUndefined()
    expect(result.timeEntries[0].id).toBeTruthy()
    expect(result.warnings.some(w => w.field === 'TIMEID')).toBe(true)
  })

  it('legt Mitarbeiter ohne Rolle an - die kommt erst über die Projekt-Zuordnung', async () => {
    const result = await importTimesheetExcel(excelFile([row()]))

    expect(result.employees).toHaveLength(1)
    expect(result.employees[0].personalnummer).toBe('30000001')
    expect(result.employees[0].name).toBe('MUSTER, Anna')
    expect(result.employees[0].active).toBe(true)
  })

  it('trennt Namen mit Bindestrich korrekt von der Personalnummer', async () => {
    const result = await importTimesheetExcel(
      excelFile([row({ [COL.RESOURCE]: 'EN-NAKDI, Marie-Luise - 30000009' })]),
    )

    expect(result.employees[0].name).toBe('EN-NAKDI, Marie-Luise')
    expect(result.employees[0].personalnummer).toBe('30000009')
  })

  it('überspringt Zeilen ohne Stunden und ohne WBS-Nummer', async () => {
    const result = await importTimesheetExcel(
      excelFile([
        row({ [COL.EFFORT]: 0, [COL.TIME_ID]: '{ohne-stunden}' }),
        row({ [COL.WBS_NUMBER]: '', [COL.TIME_ID]: '{ohne-wbs}' }),
        row({ [COL.TIME_ID]: '{gut}' }),
      ]),
    )

    expect(result.timeEntries).toHaveLength(1)
    expect(result.warnings.some(w => w.field === 'EFFORT')).toBe(true)
    expect(result.warnings.some(w => w.field === 'WBS_NUMBER')).toBe(true)
  })

  it('übernimmt die erste Datenzeile auch ohne Formatierungszeile davor', async () => {
    // Der echte Zeiterfassungs-Export traegt genau eine Kopfzeile. Der Import begann
    // fest bei Zeilenindex 2 und verschluckte damit die erste Datenzeile jeder
    // Datei - in der August-Datei acht Stunden, ohne Warnung und ohne Spur im
    // Importprotokoll.
    const result = await importTimesheetExcel(
      excelFileSingleHeader([
        row({ [COL.TIME_ID]: '{erste}' }),
        row({ [COL.TIME_ID]: '{zweite}' }),
      ]),
    )

    expect(result.timeEntries).toHaveLength(2)
    expect(result.timeEntries.map(e => e.timeId)).toEqual(['{erste}', '{zweite}'])
  })

  it('macht die Kopfzeile nicht zum Zeiteintrag', async () => {
    // Gegenprobe zur Kopfzeilenerkennung: die Ueberschriften duerfen unter
    // keinen Umstaenden als Eintrag mit unlesbarer Stundenzahl durchrutschen -
    // ein einziger solcher Wert macht jede Summe zu NaN.
    const result = await importTimesheetExcel(excelFileSingleHeader([row({ [COL.TIME_ID]: '{echt}' })]))

    expect(result.timeEntries).toHaveLength(1)
    expect(result.timeEntries[0].timeId).toBe('{echt}')
    expect(result.timeEntries.every(e => Number.isFinite(e.effort))).toBe(true)
  })

  it('führt Dateiname und Prüfsumme fürs Importprotokoll mit', async () => {
    const result = await importTimesheetExcel(excelFile([row()], 'August_2026.xlsx'))

    expect(result.stats.fileName).toBe('August_2026.xlsx')
    expect(result.stats.checksum).toMatch(/^[0-9a-f]{16}$/)
  })

  it('liefert für dieselbe Datei dieselbe Prüfsumme und für andere Daten eine andere', async () => {
    const bytes = await excelFile([row()]).arrayBuffer()
    const twice = await Promise.all([
      importTimesheetExcel(new File([bytes], 'a.xlsx')),
      importTimesheetExcel(new File([bytes], 'b.xlsx')),
    ])

    expect(twice[0].stats.checksum).toBe(twice[1].stats.checksum)

    const andere = await importTimesheetExcel(excelFile([row({ [COL.EFFORT]: 4, [COL.TIME_ID]: '{anders}' })]))
    expect(andere.stats.checksum).not.toBe(twice[0].stats.checksum)
  })
})
