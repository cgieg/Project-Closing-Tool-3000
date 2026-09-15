import type { Bundle, Project, Employee, Role, RateCard, TimeEntry, BillingSnapshot, ProjectResourceAssignment, AuditLogEntry, PurchaseOrder, BudgetVerbrauch } from './index'

export interface ProjectState {
  schemaVersion: string
  appVersion: string
  currentSnapshotId: string
  snapshots: BillingSnapshot[]
  rateCards: RateCard[]
  roles: Role[]
  employees: Employee[]
  bundles: Bundle[]
  projects: Project[]
  timeEntries: TimeEntry[]
  projectAssignments?: ProjectResourceAssignment[]
  /** Import-, Änderungs-, Freigabe- und Exportprotokoll. Neueste zuerst beim Anzeigen. */
  auditLog?: AuditLogEntry[]
  purchaseOrders?: PurchaseOrder[]
  budgetConsumption?: BudgetVerbrauch[]
}
