import type { AuditLogCategory, AuditLogEntry, ProjectState } from '../types'
import { getCurrentUser } from './currentUser'

/**
 * Haengt einen Protokolleintrag an - eine der vier Auspraegungen des
 * Pruefpfads (Import, Aenderung, Freigabe, Export).
 *
 * Reine Datenfunktion: der Aufrufer entscheidet ueber onStateUpdate, wann der
 * neue Zustand geschrieben wird. Kein Eintrag wird je entfernt oder veraendert -
 * das Protokoll selbst ist Teil der Revisionssicherheit.
 */
export function appendAuditLog(
  state: ProjectState,
  category: AuditLogCategory,
  message: string,
  options: { detail?: string; bundleId?: string; snapshotId?: string; by?: string } = {},
): ProjectState {
  const entry: AuditLogEntry = {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    category,
    at: new Date(),
    by: options.by ?? getCurrentUser() ?? 'Unbekannt',
    message,
    detail: options.detail,
    bundleId: options.bundleId,
    snapshotId: options.snapshotId,
  }

  return { ...state, auditLog: [...(state.auditLog ?? []), entry] }
}

/** Neueste zuerst - so liest man ein Protokoll. */
export function auditLogOf(state: ProjectState): AuditLogEntry[] {
  return [...(state.auditLog ?? [])].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
}
