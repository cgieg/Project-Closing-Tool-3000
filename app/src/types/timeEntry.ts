export interface TimeEntry {
  timeId?: string
  id?: string
  wbsNumber: string
  wbsCode?: string
  parentPath: string
  task: string
  taskType?: string
  resource: string
  date: Date
  effortHours: number
  effort?: number
  status: string
  comment?: string
  isProductive: boolean
  projectName: string
  chargeable: boolean
}
