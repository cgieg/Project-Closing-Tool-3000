import { jsPDF } from 'jspdf'
import type { Project, ProjectState } from '../types'
import { activePurchaseOrder, projectBudgetOverview, type ProjectBudgetOverview } from './budgetAggregation'

/**
 * Budgetbericht als PDF: Budget, Verbrauch und Rest je Projekt, gruppiert nach
 * Bundle (Kunde) - fuer das Management, kein Beleg im Rechtssinn.
 *
 * Eigenes Modul statt Erweiterung von monthlyReportPdf.ts: andere Frage (Budget-
 * Status je Projekt zu einem Stichtag statt Umsatz eines Monats), andere
 * Datenquelle (budgetAggregation statt billingAggregation).
 */

const NAVY: [number, number, number] = [27, 42, 74]
const INK: [number, number, number] = [26, 32, 38]
const MUTED: [number, number, number] = [110, 124, 138]
const RULE: [number, number, number] = [200, 212, 222]

const MARGIN = { left: 14, right: 14, top: 14, bottom: 16 }
const ROW_HEIGHT = 5.6

function currency(value: number): string {
  return `${value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('de-DE')
}

function drawHeader(doc: jsPDF, pageWidth: number, stichtag: Date): number {
  const headerHeight = 20
  let y = MARGIN.top

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...NAVY)
  doc.text('Budgetbericht', MARGIN.left, y + 6)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...MUTED)
  doc.text(`Budget, Verbrauch und Rest je Projekt · Stand ${formatDate(stichtag)}`, MARGIN.left, y + 12)

  y += headerHeight + 3

  doc.setDrawColor(...NAVY)
  doc.setLineWidth(0.6)
  doc.line(MARGIN.left, y, pageWidth - MARGIN.right, y)

  return y + 8
}

function drawFooters(doc: jsPDF, stichtag: Date): void {
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
    doc.text(`Budgetbericht · Stand ${formatDate(stichtag)}`, MARGIN.left, pageHeight - MARGIN.bottom + 9)
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

/** Zeichnet eine Tabelle mit Kopfzeile und Seitenumbruch. Gibt die Y-Position danach zurück. */
function drawTable(
  doc: jsPDF,
  startY: number,
  columns: TableColumn[],
  rows: string[][],
  options: { totalRow?: string[]; onNewPage: () => number },
): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const available = pageWidth - MARGIN.left - MARGIN.right
  const scale = available / columns.reduce((sum, c) => sum + c.width, 0)
  const widths = columns.map(c => c.width * scale)

  let y = startY

  const drawHeaderRow = () => {
    doc.setFillColor(...NAVY)
    doc.rect(MARGIN.left, y, available, ROW_HEIGHT, 'F')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(255, 255, 255)

    let x = MARGIN.left
    columns.forEach((column, i) => {
      if (column.align === 'right') {
        doc.text(column.title, x + widths[i] - 2, y + ROW_HEIGHT - 1.6, { align: 'right' })
      } else {
        doc.text(column.title, x + 2, y + ROW_HEIGHT - 1.6)
      }
      x += widths[i]
    })
    y += ROW_HEIGHT
  }

  const drawRow = (cells: string[], bold = false, shaded = false) => {
    if (shaded) {
      doc.setFillColor(245, 248, 250)
      doc.rect(MARGIN.left, y, available, ROW_HEIGHT, 'F')
    }

    doc.setFont('helvetica', bold ? 'bold' : 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK)

    let x = MARGIN.left
    columns.forEach((column, i) => {
      const text = cells[i] ?? ''
      if (column.align === 'right') {
        doc.text(text, x + widths[i] - 2, y + ROW_HEIGHT - 1.6, { align: 'right' })
      } else {
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
      y = options.onNewPage()
      drawHeaderRow()
    }
    drawRow(cells, false, index % 2 === 1)
  })

  if (options.totalRow) {
    if (y + ROW_HEIGHT > pageHeight - MARGIN.bottom) {
      doc.addPage()
      y = options.onNewPage()
      drawHeaderRow()
    }
    doc.setDrawColor(...NAVY)
    doc.setLineWidth(0.5)
    doc.line(MARGIN.left, y, pageWidth - MARGIN.right, y)
    drawRow(options.totalRow, true)
  }

  return y
}

const BUDGET_COLUMNS: TableColumn[] = [
  { title: 'Projekt', width: 46 },
  { title: 'PO', width: 30 },
  { title: 'Budget', width: 28, align: 'right' },
  { title: 'Verbrauch', width: 28, align: 'right' },
  { title: 'Rest', width: 28, align: 'right' },
  { title: '%', width: 16, align: 'right' },
]

interface BundleGroup {
  name: string
  kunde?: string
  rows: { project: Project; overview: ProjectBudgetOverview; po?: string }[]
}

function bundleTotals(group: BundleGroup) {
  const budget = group.rows.reduce((sum, r) => sum + r.overview.gesamtBudget, 0)
  const verbrauch = group.rows.reduce((sum, r) => sum + r.overview.gesamtVerbrauch, 0)
  return {
    budget,
    verbrauch,
    rest: budget - verbrauch,
    prozent: budget > 0 ? Math.round((verbrauch / budget) * 1000) / 10 : 0,
  }
}

function drawBundleSection(doc: jsPDF, startY: number, group: BundleGroup, stichtag: Date): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const available = pageWidth - MARGIN.left - MARGIN.right
  const newPage = () => drawHeader(doc, pageWidth, stichtag)

  let y = startY
  const barHeight = group.kunde ? 13.5 : 9.5

  if (y + barHeight + 3 * ROW_HEIGHT > pageHeight - MARGIN.bottom) {
    doc.addPage()
    y = newPage()
  }

  const totals = bundleTotals(group)

  doc.setFillColor(...NAVY)
  doc.rect(MARGIN.left, y, available, barHeight, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12.5)
  doc.setTextColor(255, 255, 255)
  doc.text(group.name, MARGIN.left + 3, y + 6)
  doc.text(`${currency(totals.rest)} Rest`, pageWidth - MARGIN.right - 3, y + 6, { align: 'right' })

  if (group.kunde) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(200, 220, 235)
    doc.text(`Kunde: ${group.kunde}`, MARGIN.left + 3, y + 11)
  }

  y += barHeight + 5

  y = drawTable(
    doc,
    y,
    BUDGET_COLUMNS,
    group.rows.map(r => [
      r.project.name,
      r.po ?? '–',
      currency(r.overview.gesamtBudget),
      currency(r.overview.gesamtVerbrauch),
      currency(r.overview.gesamtRest),
      `${r.overview.prozent.toLocaleString('de-DE')} %`,
    ]),
    {
      totalRow: [
        'Gesamt',
        '',
        currency(totals.budget),
        currency(totals.verbrauch),
        currency(totals.rest),
        `${totals.prozent.toLocaleString('de-DE')} %`,
      ],
      onNewPage: newPage,
    },
  )

  return y + 8
}

/** Baut den Budgetbericht über alle Projekte, gruppiert nach Bundle. */
export function buildBudgetReportPdf(state: ProjectState, stichtag?: Date): jsPDF {
  const effectiveStichtag = stichtag ?? new Date()
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()

  const byBundle = new Map<string, Project[]>()
  state.projects.forEach(project => {
    const list = byBundle.get(project.bundleId) ?? []
    list.push(project)
    byBundle.set(project.bundleId, list)
  })

  const groups: BundleGroup[] = Array.from(byBundle.entries())
    .map(([bundleId, projects]) => {
      const bundle = state.bundles.find(b => b.id === bundleId)
      const rows = [...projects]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map(project => ({
          project,
          overview: projectBudgetOverview(state, project.id, effectiveStichtag),
          po: activePurchaseOrder(state, project.id)?.poNummer,
        }))
      return { name: bundle?.name ?? 'Ohne Bundle', kunde: bundle?.kunde, rows }
    })
    .sort((a, b) => a.name.localeCompare(b.name))

  let y = drawHeader(doc, pageWidth, effectiveStichtag)

  const gesamtBudget = groups.reduce((sum, g) => sum + bundleTotals(g).budget, 0)
  const gesamtVerbrauch = groups.reduce((sum, g) => sum + bundleTotals(g).verbrauch, 0)
  const gesamtRest = gesamtBudget - gesamtVerbrauch
  const gesamtProzent = gesamtBudget > 0 ? Math.round((gesamtVerbrauch / gesamtBudget) * 1000) / 10 : 0

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text('GESAMTBUDGET', MARGIN.left, y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...NAVY)
  doc.text(currency(gesamtBudget), MARGIN.left, y + 7)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text(
    `Verbraucht ${currency(gesamtVerbrauch)} (${gesamtProzent.toLocaleString('de-DE')} %) · Rest ${currency(gesamtRest)}`,
    pageWidth - MARGIN.right,
    y + 7,
    { align: 'right' },
  )
  y += 14

  if (groups.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...MUTED)
    doc.text('Keine Projekte mit Budgetdaten vorhanden.', MARGIN.left, y + 4)
  } else {
    groups.forEach(group => {
      y = drawBundleSection(doc, y, group, effectiveStichtag)
    })
  }

  drawFooters(doc, effectiveStichtag)
  return doc
}

/** Dateiname für den Download. */
export function budgetReportFileName(stichtag?: Date): string {
  const iso = (stichtag ?? new Date()).toISOString().slice(0, 10)
  return `Budgetbericht_${iso}.pdf`
}
