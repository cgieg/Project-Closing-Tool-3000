import type { Standort } from './standort'

export interface RateCard {
  id: string
  standort: Standort
  funktion: string
  level: 'Expert' | 'Senior' | 'Intermediate' | 'Junior'
  tagessatz: number
  gueltigVon?: Date
  gueltigBis?: Date
  organisation?: string
}
