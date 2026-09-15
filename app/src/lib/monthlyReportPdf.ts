import { jsPDF } from 'jspdf'
import type { ProjectState } from '../types'
import { billingByProject, revenueByBundle, type BundleRevenue } from './billingAggregation'

/**
 * Monatsbericht als PDF: Umsatz je Rolle und je Projekt, aggregiert je Bundle.
 *
 * Eigenes Modul statt Erweiterung von leistungsnachweisPdf.ts - andere Frage
 * (wie verteilt sich der Umsatz eines Monats), andere Leser (Controlling/PM statt
 * Kunde), kein Beleg im Rechtssinn.
 */

const NAVY: [number, number, number] = [27, 42, 74]
const AZURE: [number, number, number] = [37, 99, 235]
const INK: [number, number, number] = [26, 32, 38]
const MUTED: [number, number, number] = [110, 124, 138]
const RULE: [number, number, number] = [200, 212, 222]
const TRACK: [number, number, number] = [230, 236, 240]

const MARGIN = { left: 14, right: 14, top: 14, bottom: 16 }

function currency(value: number): string {
  return `${value.toLocaleString('de-DE', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`
}

function formatMonth(month: string): string {
  const date = new Date(`${month}-01T00:00:00`)
  if (Number.isNaN(date.getTime())) return month
  return date.toLocaleDateString('de-DE', { year: 'numeric', month: 'long' })
}

function drawHeader(doc: jsPDF, pageWidth: number, month: string): number {
  const headerHeight = 20
  let y = MARGIN.top

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(17)
  doc.setTextColor(...NAVY)
  doc.text('Monatsbericht', MARGIN.left, y + 6)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...MUTED)
  doc.text(`Umsatz je Rolle und Projekt · ${formatMonth(month)}`, MARGIN.left, y + 12)

  y += headerHeight + 3

  doc.setDrawColor(...NAVY)
  doc.setLineWidth(0.6)
  doc.line(MARGIN.left, y, pageWidth - MARGIN.right, y)

  return y + 8
}

function drawFooters(doc: jsPDF, month: string): void {
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
    doc.text(`Monatsbericht ${formatMonth(month)}`, MARGIN.left, pageHeight - MARGIN.bottom + 9)
    doc.text(
      `Seite ${page} von ${pageCount}`,
      pageWidth - MARGIN.right,
      pageHeight - MARGIN.bottom + 9,
      { align: 'right' },
    )
  }
}

function sectionTitle(doc: jsPDF, y: number, text: string, color: [number, number, number] = NAVY): number {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...color)
  doc.text(text, MARGIN.left, y)
  return y + 5
}

interface BarDatum {
  label: string
  value: number
}

/**
 * Zeichnet horizontale Balken: Label links, Balken in der Mitte, Betrag rechts.
 *
 * Bricht die Seite um, sobald eine Zeile nicht mehr passt - jsPDF kennt keinen
 * automatischen Fluss, das muss diese Funktion selbst pruefen.
 */
function drawBarChart(
  doc: jsPDF,
  startY: number,
  data: BarDatum[],
  options: { onNewPage: () => number },
): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const available = pageWidth - MARGIN.left - MARGIN.right

  // Breiter als vorher - das Rollen-Label traegt jetzt den Standort mit
  // ("Senior Software Engineer (Rumänien)"), sonst schneidet splitTextToSize ihn ab.
  const labelWidth = 66
  const valueWidth = 26
  const trackWidth = available - labelWidth - valueWidth - 4
  const rowHeight = 6.4
  const barHeight = 3.2

  const max = Math.max(...data.map(d => d.value), 1)
  let y = startY

  data.forEach(row => {
    if (y + rowHeight > pageHeight - MARGIN.bottom) {
      doc.addPage()
      y = options.onNewPage()
    }

    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK)
    const label = doc.splitTextToSize(row.label, labelWidth - 2)[0] ?? ''
    doc.text(label, MARGIN.left, y + barHeight + 1)

    const trackX = MARGIN.left + labelWidth
    doc.setFillColor(...TRACK)
    doc.roundedRect(trackX, y, trackWidth, barHeight, 0.6, 0.6, 'F')

    const fillWidth = Math.max(1.5, (row.value / max) * trackWidth)
    doc.setFillColor(...AZURE)
    doc.roundedRect(trackX, y, fillWidth, barHeight, 0.6, 0.6, 'F')

    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...INK)
    doc.text(currency(row.value), pageWidth - MARGIN.right, y + barHeight + 1, { align: 'right' })

    y += rowHeight
  })

  return y + 2
}

function drawBundleSection(doc: jsPDF, startY: number, bundle: BundleRevenue, month: string): number {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const available = pageWidth - MARGIN.left - MARGIN.right
  const newPage = () => drawHeader(doc, pageWidth, month)

  let y = startY

  // Kopfbalken plus die beiden folgenden Ueberschriften brauchen am Stueck rund
  // 26mm - weniger Platz lohnt den Seitenumbruch schon vorher.
  if (y + 26 > pageHeight - MARGIN.bottom) {
    doc.addPage()
    y = newPage()
  }

  // Voller Farbbalken statt blossem Text - eine Ueberschrift zwischen zwei
  // Balkendiagrammen geht sonst im Grau der Zahlen unter, gerade beim zweiten
  // und dritten Bundle auf derselben Seite.
  const barHeight = bundle.kunde ? 13.5 : 9.5
  doc.setFillColor(...NAVY)
  doc.rect(MARGIN.left, y, available, barHeight, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12.5)
  doc.setTextColor(255, 255, 255)
  doc.text(bundle.name, MARGIN.left + 3, y + 6)
  doc.text(currency(bundle.total), pageWidth - MARGIN.right - 3, y + 6, { align: 'right' })

  if (bundle.kunde) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8.5)
    doc.setTextColor(200, 220, 235)
    doc.text(`Kunde: ${bundle.kunde}`, MARGIN.left + 3, y + 11)
  }

  y += barHeight + 7

  y = sectionTitle(doc, y, `Umsatz je Rolle · ${bundle.byRole.length} Rolle(n)`)
  y = drawBarChart(
    doc,
    y,
    bundle.byRole.map(r => ({ label: r.roleLabel, value: r.betrag })),
    { onNewPage: newPage },
  )
  y += 5

  if (y + 12 > pageHeight - MARGIN.bottom) {
    doc.addPage()
    y = newPage()
  }
  y = sectionTitle(doc, y, `Umsatz je Projekt · ${bundle.byProject.length} Projekt(e)`)
  y = drawBarChart(
    doc,
    y,
    bundle.byProject.map(p => ({ label: p.projectName, value: p.betrag })),
    { onNewPage: newPage },
  )

  return y + 8
}

/** Baut den Monatsbericht ueber alle Bundles mit Umsatz. */
export function buildMonthlyReportPdf(state: ProjectState, month: string): jsPDF {
  const doc = new jsPDF({ orientation: 'p', unit: 'mm', format: 'a4', compress: true })
  const pageWidth = doc.internal.pageSize.getWidth()

  const billings = billingByProject(state, month)
  const bundles = revenueByBundle(state, billings)
  const totalRevenue = bundles.reduce((sum, b) => sum + b.total, 0)

  let y = drawHeader(doc, pageWidth, month)

  // Gesamtuebersicht - der Einstieg vor den Details je Bundle.
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text('GESAMTUMSATZ', MARGIN.left, y)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...NAVY)
  doc.text(currency(totalRevenue), MARGIN.left, y + 7)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...MUTED)
  doc.text(`${bundles.length} Bundle(s)`, pageWidth - MARGIN.right, y + 7, { align: 'right' })
  y += 14

  if (bundles.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...MUTED)
    doc.text(`Kein Umsatz für ${formatMonth(month)}.`, MARGIN.left, y + 4)
  } else {
    bundles.forEach(bundle => {
      y = drawBundleSection(doc, y, bundle, month)
    })
  }

  drawFooters(doc, month)
  return doc
}

/** Dateiname für den Download. */
export function monthlyReportFileName(month: string): string {
  return `Monatsbericht_${month}.pdf`
}
