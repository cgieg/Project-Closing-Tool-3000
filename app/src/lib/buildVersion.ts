import version from '../buildVersion.json'

/**
 * Build-Version der ausgelieferten Datei - nicht zu verwechseln mit
 * ProjectState.appVersion (Datenschema). Wird von scripts/bump-build-version.mjs
 * vor jedem `npm run build` automatisch um eins erhöht (Nullpunkt-Versionierung:
 * 0.1, 0.2, ... bis auf expliziten Wunsch hin manuell auf 1.0 gesetzt wird).
 */
export const APP_VERSION = `${version.major}.${version.minor}`
