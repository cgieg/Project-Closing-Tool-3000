import { read, utils } from 'xlsx'
import type { TimeEntry, Employee, ValidationError, ValidationWarning } from '../types'
import { classifyTaskProductivity, normalizeProjectName } from './roleResolution'
import { hashArrayBuffer } from './checksum'

export interface ImportStats {
  /** Datenzeilen in der Datei. */
  totalRows: number
  /** Tatsächlich übernommene Zeiteinträge. */
  imported: number
  /** Zeilen mit einer TimeId, die in derselben Datei schon vorkam. */
  duplicatesInFile: number
  /** Zeilen, deren TimeId bereits in einer früheren Abrechnung steckt. */
  alreadyImported: number
  /** Zeilen mit einer Task-Ausprägung, die weder klar produktiv noch unproduktiv war. */
  unclearProductivity: number
  /** Prüfsumme der Quelldatei - fürs Importprotokoll. */
  checksum: string
  fileName: string
}

export interface ImportResult {
  success: boolean
  timeEntries: TimeEntry[]
  employees: Employee[]
  warnings: ValidationWarning[]
  errors: ValidationError[]
  stats: ImportStats
}

export interface ImportOptions {
  /**
   * TimeIds, die bereits in gespeicherten Abrechnungen liegen. Solche Zeilen werden
   * übersprungen - sonst erzeugt ein versehentlich doppelt importierter Monat
   * stillschweigend doppelten Umsatz.
   */
  knownTimeIds?: ReadonlySet<string>
}

const COLUMNS = {
  WBS_ORDER: 0,
  WBS_NUMBER: 1,
  PARENTS: 2,
  TASK: 3,
  TASK_TYPE: 4,
  FIXED_FEE: 5,
  RESOURCE: 6,
  DATE: 7,
  EFFORT: 8,
  STATUS: 9,
  TIMEID: 10,
  COMMENT: 11,
  WORK_LOCATION: 12,
  START_TIME: 13,
  END_TIME: 14,
}

function excelDateToJSDate(excelDate: number): Date {
  if (typeof excelDate !== 'number') return new Date()
  // Excel serial date: days since 1899-12-30
  const MS_PER_DAY = 86400000
  const EXCEL_EPOCH = new Date(1899, 11, 30).getTime()
  return new Date(EXCEL_EPOCH + excelDate * MS_PER_DAY)
}

function extractProjectFromParents(parents: string): string {
  if (!parents) return 'Unknown'
  // Format: "Muster \ ProjectName \ SubProject \"
  const parts = parents.split('\\').map(s => s.trim()).filter(Boolean)
  return parts[1] || 'Unknown'
}

function extractNameAndNumber(resource: string): { name: string; number: string } {
  if (!resource) return { name: 'Unknown', number: '' }
  // Format: "LASTNAME, FIRSTNAME - 12345678" or "LASTNAME, FIRSTNAME – 12345678"
  // Important: Name can contain hyphens (e.g., "En-Nakdi"), so match the LAST number sequence
  const match = resource.match(/^(.+?)\s*[-–]\s*(\d+)\s*$/)
  if (match) {
    const name = match[1].trim()
    const number = match[2].trim()
    return { name, number }
  }
  // Fallback: if no match, assume whole string is name
  return { name: resource.trim(), number: '' }
}

function classifyTaskType(task: string, taskType?: string): string {
  if (taskType === 'PM') return 'PM'
  if (taskType === 'Training') return 'Training'

  const lower = (task || '').toLowerCase()
  if (lower.includes('training')) return 'Training'
  if (lower.includes('pm') || lower.includes('project management')) return 'PM'
  if (lower.includes('overhead') || lower.includes('support')) return 'Overhead'

  return 'Task'
}

function isProductiveWBS(wbsNumber: string): boolean {
  if (!wbsNumber) return false
  // WBS 2.x = produktiv, 1.x = nicht-produktiv
  const firstPart = wbsNumber.split('.')[0]
  return firstPart === '2'
}

/**
 * Sucht die erste echte Datenzeile.
 *
 * Frueher begann der Import fest bei Zeilenindex 2 ("Row 0: formatting,
 * Row 1: headers"). Die Zeiterfassungs-Exporte tragen aber nur eine einzige Kopfzeile,
 * sodass die erste Datenzeile jeder Datei stillschweigend aus der Abrechnung
 * verschwand - ohne Warnung, ohne Spur im Importprotokoll.
 *
 * Statt einer festen Zeilennummer wird die Kopfzeile daran erkannt, dass ihr
 * das Datum als Zahl und eine Stundenzahl fehlen. Das haelt auch dann, wenn ein
 * Export doch wieder eine Formatierungszeile voranstellt.
 */
function findFirstDataRow(rows: any[][]): number {
  const limit = Math.min(rows.length, 20)

  for (let i = 0; i < limit; i++) {
    const row = rows[i]
    if (!row || row.length === 0) continue

    // An der Kopfzeile selbst festmachen, nicht an der ersten gueltigen
    // Datenzeile: eine erste Zeile ohne Stunden oder ohne WBS-Nummer soll
    // gemeldet und uebersprungen werden, nicht unbemerkt den Startpunkt
    // verschieben.
    const date = String(row[COLUMNS.DATE] ?? '').trim().toLowerCase()
    const effort = String(row[COLUMNS.EFFORT] ?? '').trim().toLowerCase()
    if (date === 'date' && effort === 'effort') return i + 1
  }

  // Keine Kopfzeile erkannt: bei 0 beginnen, damit keine Zeile verloren geht.
  // Eine dabei uebersehene Kopfzeile scheitert an der Stundenpruefung und wird
  // als Warnung sichtbar, statt still als Eintrag zu landen.
  return 0
}

function generateTimeId(): string {
  // Generate a GUID-like string
  return `{${Math.random().toString(36).substr(2, 8)}-${Math.random().toString(36).substr(2, 4)}-${Math.random().toString(36).substr(2, 4)}-${Math.random().toString(36).substr(2, 4)}-${Math.random().toString(36).substr(2, 12)}}`
}

export async function importTimesheetExcel(
  file: File,
  options: ImportOptions = {}
): Promise<ImportResult> {
  const warnings: ValidationWarning[] = []
  const errors: ValidationError[] = []
  const timeEntries: TimeEntry[] = []
  const employeeMap = new Map<string, Employee>()

  const knownTimeIds = options.knownTimeIds ?? new Set<string>()
  const seenTimeIds = new Set<string>()
  let duplicatesInFile = 0
  let alreadyImported = 0
  let unclearProductivity = 0

  try {
    const arrayBuffer = await file.arrayBuffer()
    // Vor dem Parsen berechnet, damit sie auch dann feststeht, wenn die Datei
    // sich als ungueltig herausstellt - das Importprotokoll soll trotzdem
    // wissen, welche Datei versucht wurde.
    const checksum = await hashArrayBuffer(arrayBuffer)
    const workbook = read(new Uint8Array(arrayBuffer), { type: 'array' })

    if (workbook.SheetNames.length === 0) {
      return {
        success: false,
        timeEntries: [],
        employees: [],
        warnings,
        errors: [{ row: 0, field: 'File', message: 'Keine Sheets in Excel-Datei gefunden' }],
        stats: { totalRows: 0, imported: 0, duplicatesInFile, alreadyImported, unclearProductivity, checksum, fileName: file.name },
      }
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const rawData = utils.sheet_to_json(sheet, { header: 1 }) as any[][]

    // Die Kopfzeile wird am Inhalt erkannt, nicht an einer festen Zeilennummer -
    // siehe findFirstDataRow.
    const firstDataRow = findFirstDataRow(rawData)

    let dataRowCount = 0
    for (let rowIndex = firstDataRow; rowIndex < rawData.length; rowIndex++) {
      const row = rawData[rowIndex]
      if (!row || row.length === 0) continue

      dataRowCount++
      const actualRow = rowIndex + 1 // Excel row number (1-indexed)

      try {
        // Extract fields
        const wbsOrder = row[COLUMNS.WBS_ORDER]
        const wbsNumber = String(row[COLUMNS.WBS_NUMBER] || '').trim()
        const parents = String(row[COLUMNS.PARENTS] || '').trim()
        const task = String(row[COLUMNS.TASK] || '').trim()
        const taskType = String(row[COLUMNS.TASK_TYPE] || '').trim()
        const resource = String(row[COLUMNS.RESOURCE] || '').trim()
        const date = row[COLUMNS.DATE]
        const effort = Number(row[COLUMNS.EFFORT] || 0)
        const status = String(row[COLUMNS.STATUS] || '').trim()
        const timeid = String(row[COLUMNS.TIMEID] || '').trim()
        const comment = String(row[COLUMNS.COMMENT] || '').trim()

        // Validation
        if (!wbsNumber) {
          warnings.push({ row: actualRow, field: 'WBS_NUMBER', message: 'WBS-Nummer fehlt' })
          continue
        }

        if (!resource) {
          errors.push({ row: actualRow, field: 'RESOURCE', message: 'Ressource/Mitarbeiter fehlt' })
          continue
        }

        // Number.isFinite fängt auch NaN ab: ein nicht lesbarer Stundenwert ist
        // weder groesser noch kleiner als 0 und rutschte bisher durch - ein
        // einziger solcher Eintrag macht anschliessend jede Summe zu NaN.
        if (!Number.isFinite(effort) || effort <= 0) {
          warnings.push({ row: actualRow, field: 'EFFORT', message: `Ungültige Stundenanzahl: ${row[COLUMNS.EFFORT]}` })
          continue
        }

        // Dubletten abweisen. Nur echte TimeIds aus der Datei prüfen - erzeugte Ids
        // sind zufällig und könnten sich nie überschneiden.
        if (timeid) {
          if (knownTimeIds.has(timeid)) {
            alreadyImported++
            warnings.push({
              row: actualRow,
              field: 'TIMEID',
              message: `Bereits in einer früheren Abrechnung enthalten: ${timeid}`,
            })
            continue
          }

          if (seenTimeIds.has(timeid)) {
            duplicatesInFile++
            warnings.push({
              row: actualRow,
              field: 'TIMEID',
              message: `Doppelte TimeId in dieser Datei: ${timeid}`,
            })
            continue
          }

          seenTimeIds.add(timeid)
        } else {
          warnings.push({
            row: actualRow,
            field: 'TIMEID',
            message: 'TimeId fehlt - Eintrag wird ohne Dublettenschutz übernommen',
          })
        }

        // Parse data
        // Task trägt den Projektnamen samt Ausprägung ("Atlas - Productive").
        // Die Ausprägung gehört nicht zum Projekt - sie steckt in WBS und chargeable.
        const projectName = normalizeProjectName(task || extractProjectFromParents(parents))
        const { name, number } = extractNameAndNumber(resource)
        const jsDate = excelDateToJSDate(date)
        // Zwei Signale: die WBS-Nummer und die Ausprägung im Task-Namen. Eine
        // unbekannte Ausprägung wird gemeldet statt stillschweigend als
        // produktiv abgerechnet - die August-Fixture kennt keine einzige
        // Unproductive-Zeile, aber solche Tasks kommen künftig.
        const productivity = classifyTaskProductivity(task)
        if (isProductiveWBS(wbsNumber) && productivity === 'unclear') {
          unclearProductivity++
          warnings.push({
            row: actualRow,
            field: 'TASK',
            message: `Unbekannte Produktivitäts-Kennzeichnung "${task}" - als produktiv angenommen, bitte prüfen.`,
          })
        }
        const isProductive = isProductiveWBS(wbsNumber) && productivity !== 'unproductive'
        const taskTypeClassified = classifyTaskType(task, taskType)

        // Create TimeEntry
        const timeEntry: TimeEntry = {
          id: timeid || generateTimeId(),
          // timeId trägt ausschließlich die Id aus der Datei - erzeugte Ersatz-Ids
          // dürfen hier nicht landen, sonst blockieren sie spätere Importe grundlos.
          timeId: timeid || undefined,
          wbsNumber,
          wbsCode: wbsNumber,
          parentPath: parents,
          task,
          projectName,
          resource: name,
          date: jsDate,
          effort: effort,
          effortHours: effort,
          isProductive,
          taskType: taskTypeClassified,
          status: status === 'A' ? 'approved' : 'pending',
          comment,
          // WBS 2.x ist produktiv und geht auf die Rechnung, WBS 1.x nicht.
          // Projektmanagement, Schulungen und Overhead sind damit von Haus aus
          // nachrichtlich - einzelne Zeilen lassen sich in der Abrechnung umschalten.
          chargeable: isProductive,
        }

        timeEntries.push(timeEntry)

        // Extract Employee
        //
        // Keine Rolle am Mitarbeiter: die Rolle kommt ausschließlich aus der
        // Projekt-Zuordnung. Ohne Zuordnung landet die Person sichtbar in der
        // Klärliste (roleResolution.unresolvedChargeableAssignments) und
        // blockiert den Monatsabschluss, bis sie zugeordnet ist.
        if (number && !employeeMap.has(number)) {
          const employee: Employee = {
            id: `emp-${number}`,
            personalnummer: number,
            name,
            active: true,
          }
          employeeMap.set(number, employee)
        }
      } catch (error) {
        errors.push({
          row: actualRow,
          field: 'General',
          message: `Fehler beim Parsing: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`,
        })
      }
    }

    if (timeEntries.length === 0) {
      return {
        success: false,
        timeEntries: [],
        employees: Array.from(employeeMap.values()),
        warnings,
        errors: errors.length > 0 ? errors : [{ row: 0, field: 'Data', message: 'Keine Zeiteinträge gefunden' }],
        stats: { totalRows: dataRowCount, imported: 0, duplicatesInFile, alreadyImported, unclearProductivity, checksum, fileName: file.name },
      }
    }

    return {
      success: true,
      timeEntries,
      employees: Array.from(employeeMap.values()),
      warnings,
      errors,
      stats: {
        totalRows: dataRowCount,
        imported: timeEntries.length,
        duplicatesInFile,
        alreadyImported,
        unclearProductivity,
        checksum,
        fileName: file.name,
      },
    }
  } catch (error) {
    return {
      success: false,
      timeEntries: [],
      employees: [],
      warnings,
      errors: [
        {
          row: 0,
          field: 'File',
          message: `Excel-Parsing-Fehler: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`,
        },
      ],
      stats: { totalRows: 0, imported: 0, duplicatesInFile, alreadyImported, unclearProductivity, checksum: '', fileName: file.name },
    }
  }
}

/**
 * Alle TimeIds, die bereits in gespeicherten Abrechnungen stecken.
 * Grundlage für den Dublettenschutz beim nächsten Import.
 */
export function collectKnownTimeIds(
  snapshots: { timeEntries: { timeId?: string; id?: string }[] }[]
): Set<string> {
  const known = new Set<string>()

  snapshots.forEach(snapshot => {
    snapshot.timeEntries.forEach(entry => {
      // Ältere Bestände führen die Id nur unter id - beide berücksichtigen
      const id = entry.timeId ?? entry.id
      if (id) known.add(id)
    })
  })

  return known
}
