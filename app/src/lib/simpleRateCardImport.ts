import { read, utils } from 'xlsx'
import type { RateCard, Role } from '../types'
import { STANDORTE, parseStandort } from '../types'

export interface SimpleRateCardImportResult {
  success: boolean
  rateCards: RateCard[]
  rolesToCreate: Role[]
  errors: Array<{ row: number; message: string }>
  warnings: Array<{ row: number; message: string }>
}

const VALID_LEVELS = ['Expert', 'Senior', 'Intermediate', 'Junior'] as const

export async function importSimpleRateCards(file: File): Promise<SimpleRateCardImportResult> {
  const rateCards: RateCard[] = []
  const rolesToCreate: Role[] = []
  const errors: Array<{ row: number; message: string }> = []
  const warnings: Array<{ row: number; message: string }> = []
  const processedRoles = new Set<string>()

  try {
    const arrayBuffer = await file.arrayBuffer()
    const workbook = read(new Uint8Array(arrayBuffer), { type: 'array' })
    const sheet = workbook.Sheets[workbook.SheetNames[0]]
    const data = utils.sheet_to_json(sheet, { header: 1 }) as any[][]

    if (data.length < 2) {
      errors.push({ row: 1, message: 'Datei ist leer oder hat keine Daten' })
      return { success: false, rateCards: [], rolesToCreate: [], errors, warnings }
    }

    // Parse header row
    const headers = (data[0] || []).map((h: any) => String(h || '').trim().toLowerCase())
    const rolleIdx = headers.findIndex(h => h.includes('rolle') || h.includes('function'))
    const levelIdx = headers.findIndex(h => h.includes('level') || h.includes('seniority'))
    const satzIdx = headers.findIndex(h => h.includes('tagessatz') || h.includes('daily') || h.includes('rate'))
    const standortIdx = headers.findIndex(h => h.includes('standort') || h.includes('location'))
    const vonIdx = headers.findIndex(h => h.includes('gültig') && h.includes('von'))
    const bisIdx = headers.findIndex(h => h.includes('gültig') && h.includes('bis'))

    // Validate required columns
    if (rolleIdx === -1 || levelIdx === -1 || satzIdx === -1) {
      errors.push({
        row: 1,
        message: 'Erforderliche Spalten nicht gefunden: "Rolle", "Level", "Tagessatz"'
      })
      return { success: false, rateCards: [], rolesToCreate: [], errors, warnings }
    }

    // Parse data rows
    for (let i = 1; i < data.length; i++) {
      const row = data[i]
      if (!row || !row[rolleIdx]) continue

      const rowNum = i + 1
      const rolle = String(row[rolleIdx] || '').trim()
      const level = String(row[levelIdx] || '').trim()
      const satzStr = String(row[satzIdx] || '').trim()
      const standortStr = standortIdx >= 0 ? String(row[standortIdx] || '').trim() : ''
      const vonStr = row[vonIdx] ? String(row[vonIdx]).trim() : ''
      const bisStr = row[bisIdx] ? String(row[bisIdx]).trim() : ''

      if (!rolle) {
        errors.push({ row: rowNum, message: 'Rolle fehlt' })
        continue
      }

      if (!level || !VALID_LEVELS.includes(level as any)) {
        errors.push({
          row: rowNum,
          message: `Ungültiges Level: ${level}. Gültig: Expert, Senior, Intermediate, Junior`
        })
        continue
      }

      if (!satzStr) {
        errors.push({ row: rowNum, message: 'Tagessatz fehlt' })
        continue
      }

      const tagessatz = parseFloat(satzStr.replace(',', '.'))
      if (isNaN(tagessatz) || tagessatz <= 0) {
        errors.push({ row: rowNum, message: `Ungültiger Tagessatz: ${satzStr}` })
        continue
      }

      // Parse dates
      let gueltigVon: Date | undefined
      let gueltigBis: Date | undefined

      if (vonStr) {
        gueltigVon = parseGermanDate(vonStr)
        if (!gueltigVon) {
          warnings.push({ row: rowNum, message: `Ungültiges Datum "Gültig von": ${vonStr}` })
        }
      }

      if (bisStr) {
        gueltigBis = parseGermanDate(bisStr)
        if (!gueltigBis) {
          warnings.push({ row: rowNum, message: `Ungültiges Datum "Gültig bis": ${bisStr}` })
        }
      }

      // Standort bestimmt den Satz mit. Fehlt die Spalte, gilt Deutschland -
      // ein unbekannter Wert wird abgewiesen statt stillschweigend umgedeutet.
      let standort: RateCard['standort'] = 'Deutschland'
      if (standortStr) {
        const matched = parseStandort(standortStr)
        if (!matched) {
          errors.push({
            row: rowNum,
            message: `Unbekannter Standort: ${standortStr}. Gültig: ${STANDORTE.join(', ')}`,
          })
          continue
        }
        standort = matched
      }

      const rateCard: RateCard = {
        id: Math.random().toString(36).substring(2, 11),
        standort,
        funktion: rolle,
        level: level as any,
        tagessatz,
        gueltigVon,
        gueltigBis,
      }
      rateCards.push(rateCard)

      // Track unique role for automatic role creation
      // Standort bewusst nicht im Schluessel: die Rolle ist Funktion + Level,
      // der Standort kommt erst bei der Projektzuordnung dazu.
      const roleKey = `${rolle}|${level}`
      if (!processedRoles.has(roleKey)) {
        processedRoles.add(roleKey)
        const role: Role = {
          id: Math.random().toString(36).substring(2, 11),
          label: `${rolle} (${level})`,
          funktion: rolle,
          level: level as any,
          organisation: 'Muster GmbH Deutschland',
        }
        rolesToCreate.push(role)
      }
    }

    return {
      success: rateCards.length > 0,
      rateCards,
      rolesToCreate,
      errors,
      warnings,
    }
  } catch (err) {
    errors.push({
      row: 0,
      message: `Fehler beim Importieren: ${err instanceof Error ? err.message : 'Unbekannter Fehler'}`,
    })
    return { success: false, rateCards: [], rolesToCreate: [], errors, warnings }
  }
}

function parseGermanDate(dateStr: string): Date | undefined {
  const trimmed = dateStr.trim()
  if (!trimmed) return undefined

  // Try formats: DD.MM.YYYY, YYYY-MM-DD
  const formats = [
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
    /^(\d{4})-(\d{2})-(\d{2})$/,
  ]

  for (const format of formats) {
    const match = trimmed.match(format)
    if (!match) continue

    if (format === formats[0]) {
      const [, day, month, year] = match
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
    }

    if (format === formats[1]) {
      const [, year, month, day] = match
      return new Date(parseInt(year), parseInt(month) - 1, parseInt(day))
    }
  }

  return undefined
}
