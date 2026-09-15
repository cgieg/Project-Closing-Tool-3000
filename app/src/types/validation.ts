export interface ValidationError {
  row: number
  field: string
  message: string
}

export interface ValidationWarning {
  row: number
  field: string
  message: string
}
