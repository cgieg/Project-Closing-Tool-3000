import { jsPDF } from 'jspdf'
import type { BillingSnapshot, Project, ProjectState, SnapshotRevision, TimeEntry } from '../types'
import {
  computeSnapshotBilling,
  diffRevisions,
  lockSnapshot,
  revisionsOf,
  type RoleCorrection,
} from './revisions'
import { daysFromHours, formatDays, formatHours, roundHours } from './rounding'
import { findProjectByName } from './roleResolution'
import { appendAuditLog } from './auditLog'

/**
 * Erzeugt den Leistungsnachweis als PDF.
 *
 * Bewusst als eigenes Modul: Einzelabrechnung und Bundle-Export haben das Dokument
 * vorher je selbst gebaut - zwei fast gleiche Implementierungen, die auseinanderliefen.
 */

const NAVY: [number, number, number] = [27, 42, 74]
const INK: [number, number, number] = [26, 32, 38]
const MUTED: [number, number, number] = [110, 124, 138]
const RULE: [number, number, number] = [200, 212, 222]
const MUTED_HEAD: [number, number, number] = [74, 97, 125]
const MUTED_ROW: [number, number, number] = [238, 241, 244]
const WARN: [number, number, number] = [178, 106, 0]
const WARN_SOFT: [number, number, number] = [253, 243, 227]

const MARGIN = { left: 14, right: 14, top: 14, bottom: 16 }
const ROW_HEIGHT = 5.2

export interface PdfLine {
  funktion: string
  level: string
  standort: string
  hours: number
  days: number
  tagessatz: number
  betrag: number
  hasRateCard: boolean
}

interface HeaderInfo {
  projekt: string
  /** Auftrags-/Vertragsnummer - im Datenmodell die PO-Nummer des Projekts. */
  vertragsnummer?: string
  zeitraum: string
  version: number
  documentNumber?: string
  /** "Entwurf" · "Freigegeben" · "Korrigiert" */
  status?: string
}

/**
 * Erster bis letzter Kalendertag des Abrechnungsmonats.
 *
 * Bewusst der volle Monat, nicht der früheste bis späteste Buchungstag: ein
 * Leistungszeitraum "03.08. – 28.08." liest sich wie eine Lücke, obwohl nur an
 * diesen Tagen gebucht wurde. Der Monat, in dem die meisten Buchungen liegen,
 * bestimmt den Zeitraum - eine einzelne verirrte Buchung in einem Nachbarmonat
 * soll ihn nicht verschieben.
 */
function periodOf(entries: { date: Date | string }[]): string {
  const times = entries.map(e => new Date(e.date).getTime()).filter(t => !Number.isNaN(t))

  if (times.length === 0) return '—'

  const counts = new Map<string, number>()
  times.forEach(t => {
    const d = new Date(t)
    const key = `${d.getFullYear()}-${d.getMonth()}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  })
  const [leadYear, leadMonth] = Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])[0][0]
    .split('-')
    .map(Number)

  const first = new Date(leadYear, leadMonth, 1)
  const last = new Date(leadYear, leadMonth + 1, 0)
  return `${formatDate(first)} – ${formatDate(last)}`
}

/** Zweistellig, damit Datumsspalten sauber untereinander stehen. */
function formatDate(value: Date | string): string {
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`
}

/**
 * 32-stellige Hex-Kennung, abgeleitet aus Projekt, Fassung und Zeitpunkt.
 *
 * Kein kryptografischer Anspruch - sie muss nur bei gleicher Fassung gleich und
 * bei verschiedenen Fassungen verschieden sein.
 */
function stableFileId(projectName: string, version: number, stamp: Date): string {
  const seed = `${projectName}|${version}|${stamp.getTime()}`
  let hex = ''
  let h = 0x811c9dc5

  for (let block = 0; block < 4; block++) {
    for (let i = 0; i < seed.length; i++) {
      h ^= seed.charCodeAt(i) + block
      h = Math.imul(h, 0x01000193) >>> 0
    }
    hex += h.toString(16).padStart(8, '0')
  }

  return hex.toUpperCase()
}

/** Mit Vorzeichen - eine Korrektur ohne Richtung waere unbrauchbar. */
function signed(value: number, format: (v: number) => string): string {
  if (value === 0) return format(0)
  return value > 0 ? `+${format(value)}` : `-${format(Math.abs(value))}`
}

function currency(value: number): string {
  return value.toLocaleString('de-DE', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Kopfbereich mit Titel und Stammdaten.
 * Gibt die Y-Position zurück, ab der der Inhalt beginnt.
 */
function drawHeader(doc: jsPDF, pageWidth: number, info: HeaderInfo): number {
  const headerHeight = 20
  let y = MARGIN.top

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...NAVY)
  doc.text('Leistungsnachweis', MARGIN.left, y + 6)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...MUTED)
  const subtitle = info.documentNumber ? `${info.projekt} · ${info.documentNumber}` : info.projekt
  doc.text(subtitle, MARGIN.left, y + 12)

  y += headerHeight + 3

  doc.setDrawColor(...NAVY)
  doc.setLineWidth(0.6)
  doc.line(MARGIN.left, y, pageWidth - MARGIN.right, y)
  y += 6

  // Stammdaten als Label-Wert-Paare in zwei Spalten. Kunde entfällt bewusst -
  // er ist für diesen Anwendungsfall immer derselbe. Die Vertragsnummer ist die
  // Auftragsnummer (PO).
  const fields: [string, string][] = []
  fields.push(['Zeitraum', info.zeitraum])
  fields.push(['Vertragsnummer', info.vertragsnummer ?? 'nicht hinterlegt'])
  if (info.status) fields.push(['Status', info.status])

  const columnWidth = (pageWidth - MARGIN.left - MARGIN.right) / 2
  // Breit genug fuer "VERTRAGSNUMMER" plus Abstand - vorher stiess das Label
  // direkt an den Wert.
  const labelWidth = 34

  fields.forEach((field, index) => {
    const column = index % 2
    const row = Math.floor(index / 2)
    const x = MARGIN.left + column * columnWidth
    const lineY = y + row * 5

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text(field[0].toUpperCase(), x, lineY)

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    // Eine fehlende Vertragsnummer ist ein Mangel und wird nicht wie ein Wert gesetzt
    const missing = field[0] === 'Vertragsnummer' && !info.vertragsnummer
    doc.setTextColor(...(missing ? MUTED : INK))
    if (missing) doc.setFont('helvetica', 'italic')
    doc.text(field[1], x + labelWidth, lineY)
  })

  y += Math.ceil(fields.length / 2) * 5 + 3

  doc.setDrawColor(...RULE)
  doc.setLineWidth(0.3)
  doc.line(MARGIN.left, y, pageWidth - MARGIN.right, y)

  return y + 7
}

/** Fußzeile mit Seitenzahl und Versionshinweis, auf jeder Seite. */
function drawFooters(doc: jsPDF, version: number): void {
  const pageCount = doc.getNumberOfPages()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  for (let page = 1; page <= pageCount; page++) {
    doc.setPage(page)
    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.3)
    doc.line(
      MARGIN.left,
      pageHeight - MARGIN.bottom + 4,
      pageWidth - MARGIN.right,
      pageHeight - MARGIN.bottom + 4,
    )

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text(
      `Leistungsnachweis · Fassung ${version}`,
      MARGIN.left,
      pageHeight - MARGIN.bottom + 9,
    )
    doc.text(
      `Seite ${page} von ${pageCount}`,
      pageWidth - MARGIN.right,
      pageHeight - MARGIN.bottom + 9,
      { align: 'right' },
    )
  }
}

interface TableColumn {
  title: string
  width: number
  align?: 'left' | 'right'
}

/**
 * Zeichnet eine Tabelle mit Kopfzeile und Seitenumbruch.
 * Gibt die Y-Position nach der Tabelle zurück.
 */
function drawTable(
  doc: jsPDF,
  startY: number,
  columns: TableColumn[],
  rows: string[][],
  options: {
    totalRow?: string[]
    onNewPage?: () => number
    /** Abweichende Kopffarbe - kennzeichnet eine Tabelle, die nicht abgerechnet wird. */
    headFill?: [number, number, number]
    /** Zeilen, die zurueckgenommen dargestellt werden - etwa nicht berechnete. */
    mutedRow?: (index: number) => boolean
  } = {},
): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const available = pageWidth - MARGIN.left - MARGIN.right
  const scale = available / columns.reduce((sum, c) => sum + c.width, 0)
  const widths = columns.map(c => c.width * scale)

  let y = startY

  const drawHeaderRow = () => {
    doc.setFillColor(...(options.headFill ?? NAVY))
    doc.rect(MARGIN.left, y, available, ROW_HEIGHT, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(255, 255, 255)

    let x = MARGIN.left
    columns.forEach((column, i) => {
      const text = column.title
      if (column.align === 'right') {
        doc.text(text, x + widths[i] - 2, y + ROW_HEIGHT - 1.6, {
          align: 'right',
        })
      } else {
        doc.text(text, x + 2, y + ROW_HEIGHT - 1.6)
      }
      x += widths[i]
    })
    y += ROW_HEIGHT
  }

  const drawRow = (cells: string[], bold = false, shaded = false, muted = false) => {
    if (muted) {
      // Eigene Tönung statt nur blasserer Schrift - Farbe allein waere im
      // Schwarzweissdruck verloren.
      doc.setFillColor(...MUTED_ROW)
      doc.rect(MARGIN.left, y, available, ROW_HEIGHT, 'F')
    } else if (shaded) {
      doc.setFillColor(245, 248, 250)
      doc.rect(MARGIN.left, y, available, ROW_HEIGHT, 'F')
    }

    doc.setFont('helvetica', bold ? 'bold' : muted ? 'italic' : 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...(muted ? MUTED : INK))

    let x = MARGIN.left
    columns.forEach((column, i) => {
      const text = cells[i] ?? ''
      if (column.align === 'right') {
        doc.text(text, x + widths[i] - 2, y + ROW_HEIGHT - 1.6, {
          align: 'right',
        })
      } else {
        // Zu lange Werte beschneiden, statt in die Nachbarspalte zu laufen
        doc.text(doc.splitTextToSize(text, widths[i] - 4)[0] ?? '', x + 2, y + ROW_HEIGHT - 1.6)
      }
      x += widths[i]
    })

    doc.setDrawColor(...RULE)
    doc.setLineWidth(0.15)
    doc.line(MARGIN.left, y + ROW_HEIGHT, MARGIN.left + available, y + ROW_HEIGHT)
    y += ROW_HEIGHT
  }

  drawHeaderRow()

  rows.forEach((cells, index) => {
    if (y + ROW_HEIGHT > pageHeight - MARGIN.bottom) {
      doc.addPage()
      y = options.onNewPage ? options.onNewPage() : MARGIN.top
      drawHeaderRow()
    }
    drawRow(cells, false, index % 2 === 1, options.mutedRow?.(index) ?? false)
  })

  if (options.totalRow) {
    if (y + ROW_HEIGHT > pageHeight - MARGIN.bottom) {
      doc.addPage()
      y = options.onNewPage ? options.onNewPage() : MARGIN.top
      drawHeaderRow()
    }
    doc.setDrawColor(...NAVY)
    doc.setLineWidth(0.5)
    doc.line(MARGIN.left, y, pageWidth - MARGIN.right, y)
    drawRow(options.totalRow, true)
  }

  return y
}

function sectionTitle(
  doc: jsPDF,
  y: number,
  text: string,
  color: [number, number, number] = NAVY,
): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...color)
  doc.text(text, MARGIN.left, y)
  return y + 4
}

export interface LeistungsnachweisInput {
  /** Stammdaten, wie sie auf dem Beleg stehen. */
  projectName: string
  /** Auftrags-/Vertragsnummer - im Datenmodell die PO-Nummer des Projekts. Kunde entfällt, er ist für diesen Anwendungsfall immer derselbe. */
  purchaseOrder?: string
  version: number
  documentNumber?: string
  /** "Entwurf" · "Freigegeben" · "Korrigiert" */
  status?: string
  /** Fuer Zeitraum und Einzelnachweis. */
  timeEntries: TimeEntry[]
  lines: PdfLine[]
  totalBetrag: number
  /**
   * Abrechnungsrolle je Mitarbeiter, etwa "Senior Software Engineer".
   *
   * Ein Beleg umfasst genau ein Projekt, und pro Projekt hat eine Person genau
   * eine Rolle - deshalb genuegt die Zuordnung ueber den Namen.
   */
  roleByResource: Map<string, string>
  /**
   * Erstellungszeitpunkt im Dokument.
   *
   * Bei einer eingefrorenen Fassung bewusst deren Einfrierzeitpunkt: der erneute
   * Druck ist dann byteweise identisch und laesst sich per Pruefsumme belegen.
   */
  createdAt?: Date
  /**
   * Korrekturzeilen gegenueber der Vorfassung.
   *
   * Nur gesetzt, wenn diese Fassung eine Berichtigung ist. Steht dann als eigener
   * Abschnitt auf dem Beleg - mit Rolle, Menge, Satz und Betrag, damit sich die
   * Gutschrift daraus ablesen laesst.
   */
  /**
   * Geleistete, aber nicht berechnete Zeiten nach Rolle.
   *
   * Die Taetigkeitsangabe aus der Zeiterfassung lautet meist schlicht "Task" und traegt nichts bei.
   * Derselbe Zuschnitt wie bei der Abrechnung macht beide Abschnitte vergleichbar.
   */
  nonChargeableLines?: PdfLine[]
  correction?: {
    previousVersion: number
    lines: RoleCorrection[]
    totalDelta: number
    /** Positionen, die durch diese Korrektur aus der Rechnung fielen. */
    removedEntryIds: string[]
    /**
     * Dieselben Positionen einzeln - damit der Kunde sieht, welcher Tag
     * herausgenommen wurde und nicht nur eine Summe je Rolle.
     */
    removedDetails: { resource: string; role: string; date: Date | string; hours: number }[]
  }
}

/** Baut das Dokument. Der Aufrufer entscheidet, ob gespeichert oder als Blob gebraucht. */
export function buildLeistungsnachweisPdf(input: LeistungsnachweisInput): jsPDF {
  const { timeEntries, lines, totalBetrag, roleByResource } = input
  // compress: true deflatet die Streams. Ohne das legt jsPDF die Bildmarke roh ab -
  // 281 x 472 Pixel mal 4 Byte sind rund 530 KB je Dokument, bei 19 Projekten
  // ueber 11 MB im ZIP.
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })

  // Feste Kennung und festes Datum machen den erneuten Druck einer eingefrorenen
  // Fassung byteweise identisch - sonst wuerfelt jsPDF beides bei jedem Aufruf neu.
  // Damit laesst sich per Pruefsumme belegen, dass ein Beleg unveraendert ist.
  if (input.createdAt) {
    const stamp = new Date(input.createdAt)
    doc.setCreationDate(stamp)
    doc.setFileId(stableFileId(input.projectName, input.version, stamp))
  }
  const pageWidth = doc.internal.pageSize.getWidth()

  const chargeable = timeEntries.filter(e => e.chargeable)
  const totalHours = chargeable.reduce((sum, e) => sum + (e.effort ?? e.effortHours ?? 0), 0)

  const info: HeaderInfo = {
    projekt: input.projectName,
    vertragsnummer: input.purchaseOrder,
    zeitraum: periodOf(timeEntries),
    version: input.version,
    documentNumber: input.documentNumber,
    status: input.status,
  }

  let y = drawHeader(doc, pageWidth, info)

  // --- Abrechnung nach Rolle ---
  y = sectionTitle(doc, y, 'Abrechnung nach Rolle')

  if (lines.length === 0) {
    // Eine leere Tabelle mit "Gesamt 0,00" wirkt wie ein Fehler. Ein Satz sagt,
    // was Sache ist - etwa bei reinen Projektmanagement-Abrechnungen.
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...MUTED)
    doc.text('Keine abrechenbaren Positionen in diesem Zeitraum.', MARGIN.left, y + 3)
    y += 7
  } else {
    y = drawTable(
      doc,
      y,
      [
        { title: 'Funktion', width: 34 },
        { title: 'Level', width: 18 },
        { title: 'Standort', width: 24 },
        { title: 'Stunden', width: 16, align: 'right' },
        { title: 'Tage', width: 14, align: 'right' },
        { title: 'Tagessatz', width: 18, align: 'right' },
        { title: 'Betrag EUR', width: 22, align: 'right' },
      ],
      lines.map(line => [
        line.funktion,
        line.level,
        line.standort,
        formatHours(line.hours),
        formatDays(line.days),
        line.hasRateCard ? currency(line.tagessatz) : '—',
        currency(line.betrag),
      ]),
      {
        totalRow: [
          'Gesamt',
          '',
          '',
          formatHours(roundHours(totalHours)),
          formatDays(daysFromHours(totalHours)),
          '',
          currency(totalBetrag),
        ],
        onNewPage: () => drawHeader(doc, pageWidth, info),
      },
    )

    // Ohne Tagessatz steht in der Zeile ein Strich und 0,00 - das sieht aus wie ein
    // fertiger Beleg, beziffert aber nichts. Der Mangel gehoert benannt, damit das
    // Dokument nicht versehentlich hinausgeht.
    const withoutRate = lines.filter(line => !line.hasRateCard)
    if (withoutRate.length > 0) {
      const affected = withoutRate
        .map(line => `${line.level} ${line.funktion} (${line.standort})`)
        .join(', ')
      const boxWidth = pageWidth - MARGIN.left - MARGIN.right

      y += 4
      doc.setFillColor(...WARN_SOFT)
      doc.rect(MARGIN.left, y - 3, boxWidth, 11, 'F')
      doc.setDrawColor(...WARN)
      doc.setLineWidth(0.9)
      doc.line(MARGIN.left, y - 3, MARGIN.left, y + 8)

      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(...WARN)
      doc.text('Kein Tagessatz hinterlegt', MARGIN.left + 3.5, y + 0.8)

      doc.setFont('helvetica', 'normal')
      doc.setFontSize(7.5)
      doc.text(
        doc.splitTextToSize(`${affected} — mit 0,00 EUR ausgewiesen.`, boxWidth - 7)[0] ?? '',
        MARGIN.left + 3.5,
        y + 5,
      )
      y += 12
    }
  }

  // --- Nicht berechnete Zeiten ---
  //
  // Was in dieser Fassung aus der Rechnung genommen wurde, steht weiter unten als
  // Korrektur. Hier nochmals aufzufuehren waere eine Dopplung mit zwei
  // verschiedenen Deutungen derselben Stunden.
  const correctedOut = new Set(
    (input.correction?.removedEntryIds ?? []).filter(Boolean) as string[],
  )
  const freeLines = (input.nonChargeableLines ?? []).filter(line => line.hours > 0)
  const removedHoursByRole = new Map<string, number>()

  timeEntries.forEach(entry => {
    if (!correctedOut.has(entry.timeId ?? entry.id ?? '')) return
    const label = roleByResource.get(entry.resource)
    if (!label) return
    removedHoursByRole.set(
      label,
      (removedHoursByRole.get(label) ?? 0) + (entry.effort ?? entry.effortHours ?? 0),
    )
  })

  // Die korrigierten Stunden aus dieser Aufstellung herausrechnen
  const informational = freeLines
    .map(line => {
      const removed = removedHoursByRole.get(`${line.level} ${line.funktion}`) ?? 0
      const hours = roundHours(line.hours - removed)
      return { ...line, hours, days: daysFromHours(hours) }
    })
    .filter(line => line.hours > 0)

  if (informational.length > 0) {
    const freeHours = roundHours(informational.reduce((sum, line) => sum + line.hours, 0))

    y += 8
    y = sectionTitle(doc, y, 'Nicht berechnete Zeiten', MUTED_HEAD)

    // Ohne Absetzung liest sich der Abschnitt wie die Abrechnung darueber. Der
    // gedeckte Kopf und der Zusatz sagen, dass hier nichts in Rechnung geht.
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(7.5)
    doc.setTextColor(...MUTED)
    doc.text('Geleistet und nachgewiesen, jedoch nicht in Rechnung gestellt.', MARGIN.left, y + 0.4)
    y += 4.5

    y = drawTable(
      doc,
      y,
      [
        { title: 'Funktion', width: 34 },
        { title: 'Level', width: 18 },
        { title: 'Standort', width: 24 },
        { title: 'Stunden', width: 16, align: 'right' },
        { title: 'Tage', width: 14, align: 'right' },
      ],
      informational.map(line => [
        line.funktion,
        line.level,
        line.standort,
        formatHours(line.hours),
        formatDays(line.days),
      ]),
      {
        totalRow: ['Gesamt', '', '', formatHours(freeHours), formatDays(daysFromHours(freeHours))],
        onNewPage: () => drawHeader(doc, pageWidth, info),
        headFill: MUTED_HEAD,
      },
    )
  }

  // --- Rechnungskorrektur ---
  if (input.correction && input.correction.lines.length > 0) {
    const { previousVersion, lines: corrections, totalDelta } = input.correction

    y += 8
    y = sectionTitle(doc, y, `Rechnungskorrektur gegenüber Fassung ${previousVersion}`)
    y = drawTable(
      doc,
      y,
      [
        { title: 'Funktion', width: 34 },
        { title: 'Level', width: 18 },
        { title: 'Standort', width: 24 },
        { title: 'Stunden', width: 16, align: 'right' },
        { title: 'Tage', width: 14, align: 'right' },
        { title: 'Tagessatz', width: 18, align: 'right' },
        { title: 'Betrag EUR', width: 22, align: 'right' },
      ],
      corrections.map(line => [
        line.funktion,
        line.level,
        line.standort,
        signed(line.hoursDelta, formatHours),
        signed(line.daysDelta, formatDays),
        currency(line.tagessatz),
        signed(line.betragDelta, currency),
      ]),
      {
        totalRow: ['Korrekturbetrag', '', '', '', '', '', signed(totalDelta, currency)],
        onNewPage: () => drawHeader(doc, pageWidth, info),
      },
    )

    // Einzelne Positionen dazu - eine Summe je Rolle laesst offen, welcher Tag
    // betroffen war. Genau das will der Kunde bei einer Monierung nachvollziehen.
    const removed = [...input.correction.removedDetails].sort((a, b) => {
      const byResource = a.resource.localeCompare(b.resource)
      if (byResource !== 0) return byResource
      return new Date(a.date).getTime() - new Date(b.date).getTime()
    })

    if (removed.length > 0) {
      const removedHours = roundHours(removed.reduce((sum, r) => sum + r.hours, 0))

      y += 6
      y = sectionTitle(doc, y, `Entfallene Positionen (${removed.length})`)
      y = drawTable(
        doc,
        y,
        [
          { title: 'Mitarbeiter', width: 40 },
          { title: 'Rolle', width: 34 },
          { title: 'Datum', width: 18 },
          { title: 'Stunden', width: 16, align: 'right' },
        ],
        removed.map(row => [
          row.resource,
          row.role,
          formatDate(row.date),
          signed(-row.hours, formatHours),
        ]),
        {
          totalRow: ['Summe', '', '', signed(-removedHours, formatHours)],
          onNewPage: () => drawHeader(doc, pageWidth, info),
        },
      )
    }
  }

  // --- Einzelnachweis ---
  //
  // Alle geleisteten Zeiten, auch die nicht berechneten: der Nachweis belegt die
  // Leistung, die Abrechnung oben beziffert sie. Nicht berechnete Zeilen sind
  // getoent, kursiv und mit Stern gekennzeichnet - Farbe allein traegt im
  // Schwarzweissdruck nicht.
  const sorted = [...timeEntries].sort((a, b) => {
    const byResource = (a.resource || '').localeCompare(b.resource || '')
    if (byResource !== 0) return byResource
    return new Date(a.date).getTime() - new Date(b.date).getTime()
  })

  const freeCount = sorted.filter(entry => !entry.chargeable).length

  if (sorted.length > 0) {
    y += 8
    y = sectionTitle(doc, y, `Einzelnachweis (${sorted.length} Positionen)`)

    if (freeCount > 0) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(7.5)
      doc.setTextColor(...MUTED)
      doc.text(
        `* ${freeCount} Position(en) sind nachgewiesen, aber nicht berechnet.`,
        MARGIN.left,
        y + 0.4,
      )
      y += 4.5
    }

    drawTable(
      doc,
      y,
      [
        { title: 'Mitarbeiter', width: 40 },
        { title: 'Rolle', width: 34 },
        { title: 'Datum', width: 18 },
        { title: 'Stunden', width: 16, align: 'right' },
      ],
      sorted.map(entry => [
        entry.resource,
        roleByResource.get(entry.resource) ?? '—',
        formatDate(entry.date),
        formatHours(roundHours(entry.effort ?? entry.effortHours ?? 0)) +
          (entry.chargeable ? '' : ' *'),
      ]),
      {
        onNewPage: () => drawHeader(doc, pageWidth, info),
        mutedRow: index => !sorted[index].chargeable,
      },
    )
  }

  drawFooters(doc, input.version)
  return doc
}

/** Dateiname aus Projekt, Zeitraum und PO. */
export function leistungsnachweisFileName(snapshot: BillingSnapshot, project?: Project): string {
  const base = (project?.name ?? snapshot.month).replace(/[^\w\-]+/g, '_')
  const beleg = snapshot.documentNumber ? `_${snapshot.documentNumber}` : ''
  return `Leistungsnachweis_${base}${beleg}.pdf`
}

/**
 * Rechnet einen Snapshot durch und baut daraus das PDF.
 * Nutzt dieselbe Rollen- und Rate-Card-Auflösung wie Abrechnung und Dashboard.
 */
export function buildPdfForSnapshot(state: ProjectState, snapshot: BillingSnapshot): jsPDF {
  // Dieselbe Berechnung wie beim Einfrieren einer Fassung - sonst koennten
  // Arbeitsstand und eingefrorener Beleg auseinanderlaufen.
  const { lines, totalBetrag, roleByResource, nonChargeableLines } = computeSnapshotBilling(
    state,
    snapshot,
  )

  const projectName = snapshot.timeEntries[0]?.projectName ?? ''
  const project = findProjectByName(projectName, state.projects)
  const revisions = revisionsOf(snapshot)

  return buildLeistungsnachweisPdf({
    projectName: project?.name ?? projectName,
    purchaseOrder: project?.purchaseOrder,
    version: snapshot.version,
    documentNumber: snapshot.documentNumber,
    status: snapshot.locked ? (revisions.length > 1 ? 'Korrigiert' : 'Freigegeben') : 'Entwurf',
    timeEntries: snapshot.timeEntries,
    lines,
    totalBetrag,
    roleByResource,
    nonChargeableLines,
    // Laeuft gerade eine Korrektur, traegt der Arbeitsstand bereits Fassung 2,
    // ist aber noch nicht eingefroren. Ohne den Vergleich gegen die letzte
    // Fassung waere das ein Beleg, der eine Korrektur behauptet und keine zeigt.
    correction: correctionAgainstLastRevision(state, snapshot, lines, totalBetrag, roleByResource),
  })
}

/**
 * Vergleicht den laufenden Arbeitsstand mit der zuletzt eingefrorenen Fassung.
 *
 * Baut dafuer eine Fassung, die nicht gespeichert wird - nur so laesst sich
 * derselbe Diff nutzen, den auch der endgueltige Beleg verwendet.
 */
function correctionAgainstLastRevision(
  state: ProjectState,
  snapshot: BillingSnapshot,
  lines: PdfLine[],
  totalBetrag: number,
  roleByResource: Map<string, string>,
): LeistungsnachweisInput['correction'] {
  const previous = revisionsOf(snapshot)[0]
  if (!previous || previous.version >= snapshot.version) return undefined

  const draft: SnapshotRevision = {
    ...previous,
    version: snapshot.version,
    frozenAt: new Date(),
    reason: snapshot.correctionReason ?? '',
    lines: lines.map(line => ({ ...line })),
    totalBetrag,
    timeEntries: snapshot.timeEntries.map(entry => ({ ...entry })),
    roleByResource: Array.from(roleByResource.entries()),
  }

  const diff = diffRevisions(previous, draft)
  if (diff.byRole.length === 0) return undefined

  return {
    previousVersion: previous.version,
    lines: diff.byRole,
    totalDelta: diff.betragDelta,
    removedEntryIds: diff.nowNonChargeable.map(e => e.timeId ?? e.id ?? ''),
    removedDetails: removedDetailsOf(diff, previous),
  }
}

/**
 * Druckt eine eingefrorene Fassung exakt so, wie sie gestellt wurde.
 *
 * Nutzt ausschliesslich die Kopie in der Fassung - weder heutige Rate Cards noch
 * heutige Rollen-Zuordnungen fliessen ein. Nur so bleibt der Beleg belastbar.
 */
export function buildPdfForRevision(
  revision: SnapshotRevision,
  previous?: SnapshotRevision,
): jsPDF {
  const diff = previous ? diffRevisions(previous, revision) : undefined

  return buildLeistungsnachweisPdf({
    projectName: revision.context.projectName,
    purchaseOrder: revision.context.purchaseOrder,
    version: revision.version,
    documentNumber: revision.documentNumber,
    // Eine Korrektur trägt gegenüber ihrer Vorfassung immer den Status
    // "Korrigiert" - nur die allererste Fassung ist "Freigegeben".
    status: revision.version > 1 ? 'Korrigiert' : 'Freigegeben',
    timeEntries: revision.timeEntries,
    lines: revision.lines,
    totalBetrag: revision.totalBetrag,
    roleByResource: new Map(revision.roleByResource),
    nonChargeableLines: revision.nonChargeableLines,
    createdAt: new Date(revision.frozenAt),
    correction:
      diff && diff.byRole.length > 0
        ? {
            previousVersion: previous!.version,
            lines: diff.byRole,
            totalDelta: diff.betragDelta,
            removedEntryIds: diff.nowNonChargeable.map(e => e.timeId ?? e.id ?? ''),
            removedDetails: removedDetailsOf(diff, previous!),
          }
        : undefined,
  })
}

/**
 * Baut die Liste der entfallenen Positionen.
 *
 * Die Rolle kommt aus der Vorfassung: in der neuen Fassung wird die Position nicht
 * mehr abgerechnet und taucht dort in der Rollenzuordnung gar nicht mehr auf.
 */
function removedDetailsOf(
  diff: ReturnType<typeof diffRevisions>,
  previous: SnapshotRevision,
): { resource: string; role: string; date: Date | string; hours: number }[] {
  const roles = new Map(previous.roleByResource)

  const asDetail = (entry: TimeEntry) => ({
    resource: entry.resource,
    role: roles.get(entry.resource) ?? '—',
    date: entry.date,
    hours: roundHours(entry.effort ?? entry.effortHours ?? 0),
  })

  return [
    ...diff.nowNonChargeable.map(asDetail),
    // Ganz weggefallene Zeilen zaehlen genauso - fuer den Kunden ist der
    // Unterschied zwischen "nicht mehr berechnet" und "geloescht" belanglos
    ...diff.removed.filter(e => e.chargeable).map(asDetail),
  ]
}

/** Dateiname einer eingefrorenen Fassung, mit Belegnummer und Fassungsnummer. */
export function revisionFileName(revision: SnapshotRevision): string {
  const base = revision.context.projectName.replace(/[^\w\-]+/g, '_')
  const beleg = revision.documentNumber ? `_${revision.documentNumber}` : ''
  return `Leistungsnachweis_${base}${beleg}_Fassung-${revision.version}.pdf`
}

/**
 * Baut aus einer jsPDF-Instanz einen Base64-String für die Ablage in der Fassung.
 * Nicht ueber output('datauristring'): das haengt ein data:-Prefix an, das beim
 * Wiederherstellen erst wieder abgeschnitten werden muesste.
 */
function toBase64(doc: jsPDF): string {
  return doc.output('datauristring').split(',')[1] ?? ''
}

/** Baut aus einem gespeicherten Base64-PDF wieder eine herunterladbare Blob-URL. */
export function downloadStoredPdf(base64: string, fileName: string): void {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)

  const blob = new Blob([bytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = fileName
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

/**
 * Schließt eine Abrechnung ab und legt den dabei erzeugten Beleg unverändert ab.
 *
 * Orchestriert bewusst hier statt in revisions.ts: der Datenabschluss
 * (lockSnapshot) kennt keine PDF-Erzeugung, und leistungsnachweisPdf.ts darf
 * umgekehrt von revisions.ts importieren, ohne einen Zirkelbezug zu erzeugen.
 * Schreibt zusätzlich den Freigabe-Eintrag ins Protokoll.
 */
export function lockSnapshotWithDocument(state: ProjectState, snapshotId: string): ProjectState {
  const locked = lockSnapshot(state, snapshotId)
  const snapshot = locked.snapshots.find(s => s.id === snapshotId)
  if (!snapshot || snapshot === state.snapshots.find(s => s.id === snapshotId)) {
    // lockSnapshot hat nichts veraendert (blockiert oder nicht gefunden)
    return locked
  }

  const revisions = revisionsOf(snapshot)
  const latest = revisions[0]
  if (!latest) return locked

  const doc = buildPdfForRevision(latest, revisions[1])
  const pdfBase64 = toBase64(doc)
  const pdfFileName = revisionFileName(latest)

  const withPdf: ProjectState = {
    ...locked,
    snapshots: locked.snapshots.map(s =>
      s.id === snapshotId
        ? {
            ...s,
            revisions: (s.revisions ?? []).map(r =>
              r.version === latest.version ? { ...r, pdfBase64, pdfFileName } : r,
            ),
          }
        : s,
    ),
  }

  return appendAuditLog(
    withPdf,
    'freigabe',
    `Leistungsnachweis ${latest.documentNumber} freigegeben (Fassung ${latest.version})`,
    { detail: latest.reason, bundleId: snapshot.bundleId, snapshotId },
  )
}
