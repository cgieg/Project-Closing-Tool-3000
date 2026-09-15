export interface Bundle {
  id: string
  name: string
  snapshotIds: string[]
  importedAt: Date
  kunde?: string
  vertragsnummer?: string
  periode?: string
}
