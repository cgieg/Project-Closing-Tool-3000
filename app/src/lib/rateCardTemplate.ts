import { utils, write } from 'xlsx'

export function downloadRateCardTemplate(): void {
  // Standort steht bewusst vor dem Satz: dieselbe Rolle kostet je Delivery Center
  // unterschiedlich, und genau diese Zeile wird im Projekt zugeordnet.
  const templateData = [
    ['Rolle', 'Level', 'Standort', 'Tagessatz (EUR)', 'Gültig ab', 'Gültig bis', 'Notizen'],
    ['Software Engineer', 'Senior', 'Deutschland', '850', '01.01.2026', '31.12.2026', ''],
    ['Software Engineer', 'Senior', 'Spanien/Portugal', '620', '01.01.2026', '31.12.2026', ''],
    ['Software Engineer', 'Senior', 'Rumänien', '540', '01.01.2026', '31.12.2026', ''],
    ['Software Engineer', 'Senior', 'Polen', '560', '01.01.2026', '31.12.2026', ''],
    ['Software Engineer', 'Senior', 'Italien', '680', '01.01.2026', '31.12.2026', ''],
    ['Software Engineer', 'Expert', 'Deutschland', '950', '01.01.2026', '31.12.2026', ''],
    ['Software Engineer', 'Intermediate', 'Deutschland', '650', '01.01.2026', '31.12.2026', ''],
    ['Softwarearchitekt', 'Senior', 'Deutschland', '1070', '01.01.2026', '31.12.2026', ''],
    ['Product Owner (PO)', 'Expert', 'Deutschland', '940', '01.01.2026', '31.12.2026', ''],
    ['Test Engineer', 'Senior', 'Deutschland', '710', '01.01.2026', '31.12.2026', ''],
  ]

  const ws = utils.aoa_to_sheet(templateData)

  // Set column widths
  ws['!cols'] = [
    { wch: 25 },  // Rolle
    { wch: 14 },  // Level
    { wch: 18 },  // Standort
    { wch: 16 },  // Tagessatz
    { wch: 12 },  // Gültig ab
    { wch: 12 },  // Gültig bis
    { wch: 20 },  // Notizen
  ]

  // Format header row
  const headerStyle = {
    fill: { fgColor: { rgb: '1B2A4A' } },
    font: { bold: true, color: { rgb: 'FFFFFF' } },
    alignment: { horizontal: 'center', vertical: 'center' },
  }

  for (let i = 0; i < 7; i++) {
    const cellAddress = utils.encode_cell({ r: 0, c: i })
    ws[cellAddress].s = headerStyle
  }

  const wb = utils.book_new()
  utils.book_append_sheet(wb, ws, 'Rate Cards')

  // Trigger download
  const wbout = write(wb, { bookType: 'xlsx', type: 'array' })
  const blob = new Blob([wbout], { type: 'application/octet-stream' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'Rate-Cards-Vorlage.xlsx'
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
