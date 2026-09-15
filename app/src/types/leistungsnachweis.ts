export interface LeistungsnachweisLine {
  roleId: string
  roleLabel: string
  hours: number
  days: number
  tagessatz: number
  betrag: number
}

export interface NonChargeableLine {
  roleId: string
  roleLabel: string
  employeeId: string
  hours: number
}

export interface Leistungsnachweis {
  projectId: string
  month: string
  lines: LeistungsnachweisLine[]
  nonChargeableLines: NonChargeableLine[]
  gesamtStunden: number
  gesamtTage: number
  gesamtBetrag: number
  budgetVerbrauch?: number
  detailEntries: any[]
}

export interface BundleUebersicht {
  bundleId: string
  projekte: {
    name: string
    betrag: number
    budget?: number
  }[]
  gesamtBetrag: number
  blendedRate?: number
}
