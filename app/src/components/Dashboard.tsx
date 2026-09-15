import { useMemo, useState } from 'react'
import type { ProjectState } from '../types'
import {
  availableMonths,
  billingByProject,
  blendedRate as calcBlendedRate,
  nonChargeableOverview,
  openTimeEntries,
  productivityShare,
  revenueByRole,
} from '../lib/billingAggregation'
import { formatDays, formatHours } from '../lib/rounding'
import { buildMonthlyReportPdf, monthlyReportFileName } from '../lib/monthlyReportPdf'
import '../styles/Dashboard.css'

interface DashboardProps {
  state: ProjectState
}

const currency = (value: number, digits = 2): string =>
  `€ ${value.toLocaleString('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

/**
 * Zaehlt auf, ohne die Zeile zu sprengen.
 * Eine vollstaendige Liste von zwoelf Projektnamen verdraengt sonst die Zahlen,
 * um die es eigentlich geht - die Gesamtzahl trägt die Information.
 */
const summarize = (names: string[], limit = 3): string => {
  if (names.length <= limit) return names.join(', ')
  return `${names.slice(0, limit).join(', ')} und ${names.length - limit} weitere`
}

const formatMonth = (month: string): string => {
  const date = new Date(`${month}-01T00:00:00`)
  if (Number.isNaN(date.getTime())) return month
  return date.toLocaleDateString('de-DE', { year: 'numeric', month: 'long' })
}

export function Dashboard({ state }: DashboardProps) {
  const months = useMemo(() => availableMonths(state), [state])
  const [selectedMonth, setSelectedMonth] = useState<string>('')

  // Der neueste Monat mit Daten ist die sinnvollste Vorauswahl.
  const activeMonth = selectedMonth && months.includes(selectedMonth) ? selectedMonth : months[0] || ''

  const billings = useMemo(
    () => (activeMonth ? billingByProject(state, activeMonth) : []),
    [state, activeMonth]
  )

  const roleRevenue = useMemo(() => revenueByRole(billings), [billings])

  const unproductive = useMemo(
    () => (activeMonth ? nonChargeableOverview(state, activeMonth) : null),
    [state, activeMonth]
  )

  // WBS-basiert und unabhängig von Handumschaltungen an "chargeable" - läuft
  // absichtlich gegen die Fakturierungsquote auseinander, sobald jemand einzelne
  // Zeilen umschaltet oder ein Projekt auf nicht fakturierbar setzt.
  const productivity = useMemo(
    () => (activeMonth ? productivityShare(state, activeMonth) : null),
    [state, activeMonth]
  )

  // Nicht monatsgebunden: welche fakturierbaren Zeiten stecken in noch keiner
  // abgeschlossenen Fassung - über alle Bundles und Monate hinweg.
  const openEntries = useMemo(() => openTimeEntries(state), [state])
  const openHoursByProject = useMemo(() => {
    const byProject = new Map<string, number>()
    openEntries.forEach(({ entry }) => {
      const h = entry.effort ?? entry.effortHours ?? 0
      byProject.set(entry.projectName, (byProject.get(entry.projectName) ?? 0) + h)
    })
    return Array.from(byProject.entries())
      .map(([projectName, hours]) => ({ projectName, hours }))
      .sort((a, b) => b.hours - a.hours)
  }, [openEntries])
  const openHoursTotal = openHoursByProject.reduce((sum, p) => sum + p.hours, 0)

  // Verlauf der Blended Rate - zeigt, ob sich der Rollenmix verteuert oder verbilligt.
  const trend = useMemo(
    () =>
      months
        .slice(0, 6)
        .map(month => {
          const monthBillings = billingByProject(state, month)
          return {
            month,
            betrag: monthBillings.reduce((sum, b) => sum + b.betrag, 0),
            rate: calcBlendedRate(monthBillings),
          }
        })
        .reverse(),
    [state, months]
  )

  const totalRevenue = billings.reduce((sum, b) => sum + b.betrag, 0)
  const totalDays = billings.reduce((sum, b) => sum + b.days, 0)
  const totalHours = billings.reduce((sum, b) => sum + b.hours, 0)
  const overallBlendedRate = calcBlendedRate(billings)

  // Fakturierungsquote: fakturierbare Stunden / erbrachte Stunden.
  //
  // Bewusst nicht "Produktivitaet" genannt - Projektmanagement und Overhead sind
  // geleistete Arbeit, sie gehen nur nicht auf die Rechnung. Die Unterscheidung ist
  // fakturierbar gegen nicht fakturierbar, nicht produktiv gegen unproduktiv.
  const nonChargeableHours = billings.reduce((sum, b) => sum + b.nonChargeable.hours, 0)
  const deliveredHours = totalHours + nonChargeableHours
  const billableShare = deliveredHours > 0 ? (totalHours / deliveredHours) * 100 : 0

  // Eine Umsatzrangliste mit Null-Zeilen ist Rauschen. In der Tabelle stehen sie
  // weiterhin - dort geht es um Vollstaendigkeit, hier um den Vergleich.
  const revenueBillings = billings.filter(b => b.betrag > 0)

  /**
   * Umsatz je Bundle, darin die Projekte mit ihrem Anteil.
   *
   * Der Anteil bezieht sich auf das Bundle, nicht auf den Monat: ein Projekt macht
   * 12 % seines Vertrags aus, nicht 12 % von allem, was das Haus abrechnet.
   */
  const byBundle = useMemo(() => {
    const groups = new Map<
      string,
      { bundleId: string; name: string; total: number; rows: typeof revenueBillings }
    >()

    revenueBillings.forEach(billing => {
      // Ueber den Snapshot, nicht ueber project.bundleId: das Projekt-Feld wird
      // beim Anlegen oft nicht gepflegt, der Snapshot kennt sein Bundle sicher.
      const bundle = state.bundles.find(b => b.id === billing.bundleId)
      const key = bundle?.id ?? 'ohne'

      const group = groups.get(key) ?? {
        bundleId: key,
        name: bundle?.name || 'Ohne Bundle',
        total: 0,
        rows: [] as typeof revenueBillings,
      }
      group.total += billing.betrag
      group.rows.push(billing)
      groups.set(key, group)
    })

    return Array.from(groups.values())
      .map(group => ({ ...group, rows: [...group.rows].sort((a, b) => b.betrag - a.betrag) }))
      .sort((a, b) => b.total - a.total)
  }, [revenueBillings, state.bundles])
  const maxRoleRevenue = Math.max(...Array.from(roleRevenue.values()), 1)

  const missingRateCards = Array.from(new Set(billings.flatMap(b => b.missingRateCards)))
  const projectsWithoutPO = billings.filter(b => !b.purchaseOrder).map(b => b.projectName)

  if (months.length === 0) {
    return (
      <div className="dashboard">
        <div className="dashboard-header">
          <h1>Dashboard</h1>
        </div>
        <div className="dashboard-empty">
          <p>
            Noch keine Zeiteinträge importiert. Starte im Reiter <strong>Import</strong>.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div>
          <h1>Dashboard</h1>
          <p className="dashboard-subtitle">{formatMonth(activeMonth)}</p>
        </div>
        <div className="dashboard-month-selector">
          <label htmlFor="dashboard-month">Monat</label>
          <select
            id="dashboard-month"
            value={activeMonth}
            onChange={e => setSelectedMonth(e.target.value)}
          >
            {months.map(month => (
              <option key={month} value={month}>
                {formatMonth(month)}
              </option>
            ))}
          </select>
          {billings.length > 0 && (
            <button
              type="button"
              className="dashboard-report-button"
              onClick={() =>
                buildMonthlyReportPdf(state, activeMonth).save(monthlyReportFileName(activeMonth))
              }
            >
              📄 Bericht herunterladen
            </button>
          )}
        </div>
      </div>

      {missingRateCards.length > 0 && (
        <div className="dashboard-warning">
          <span aria-hidden="true">⚠</span>
          <span>
            <strong>{missingRateCards.length} Rolle(n) ohne Rate Card</strong> —{' '}
            {summarize(missingRateCards)}. Diese Stunden gehen mit 0 € in den Umsatz ein.
          </span>
        </div>
      )}

      {projectsWithoutPO.length > 0 && (
        <div className="dashboard-warning">
          <span aria-hidden="true">⚠</span>
          <span>
            <strong>{projectsWithoutPO.length} Projekt(e) ohne PO-Nummer</strong> —{' '}
            {summarize(projectsWithoutPO)}. Unter <strong>Daten → Projekte verwalten</strong>{' '}
            nachtragen.
          </span>
        </div>
      )}

      {openHoursTotal > 0 && (
        <section className="panel" style={{ marginBottom: 20 }}>
          <div className="panel-head">
            <h2>Offene Zeiten</h2>
            <span className="panel-note">
              {formatHours(openHoursTotal)} Std über alle Bundles und Monate · noch in keiner
              abgeschlossenen Fassung
            </span>
          </div>
          <BarList
            muted
            rows={openHoursByProject.slice(0, 8).map(row => ({
              key: row.projectName,
              label: row.projectName,
              value: row.hours,
              display: `${formatHours(row.hours)} Std`,
              title: `${row.projectName}: ${formatHours(row.hours)} Std offen`,
            }))}
            max={openHoursByProject[0]?.hours ?? 1}
          />
          {openHoursByProject.length > 8 && (
            <p className="chart-footnote">{openHoursByProject.length - 8} weitere Projekte mit offenen Zeiten</p>
          )}
        </section>
      )}

      {billings.length === 0 ? (
        <div className="dashboard-empty">
          <p>Keine abrechenbaren Zeiteinträge für {formatMonth(activeMonth)}.</p>
        </div>
      ) : (
        <>
          {/* Kennzahlen: Zahl zuerst, Bezeichnung darunter */}
          <div className="dashboard-kpis">
            <StatTile
              label="Umsatz"
              value={currency(totalRevenue)}
              note={`${formatDays(totalDays)} Tage · ${formatHours(totalHours)} Std`}
              accent
            />
            <StatTile
              label="Blended Rate"
              value={currency(overallBlendedRate)}
              note="je Tag über alle Rollen"
            />
            <StatTile
              label="Fakturierungsquote"
              value={`${billableShare.toFixed(1)} %`}
              note={
                nonChargeableHours > 0
                  ? `${formatHours(nonChargeableHours)} Std nicht fakturierbar`
                  : 'alle Stunden fakturierbar'
              }
              meter={billableShare}
            />
            {productivity && (
              <StatTile
                label="Produktivität"
                value={`${productivity.share.toFixed(1)} %`}
                note={`${formatHours(productivity.productiveHours)} von ${formatHours(productivity.totalHours)} Std nach WBS`}
                meter={productivity.share}
              />
            )}
            <StatTile
              label="Projekte"
              value={String(revenueBillings.length)}
              note={
                billings.length > revenueBillings.length
                  ? `mit Umsatz · ${billings.length - revenueBillings.length} ohne`
                  : 'mit Umsatz'
              }
            />
          </div>

          <div className="dashboard-charts">
            <section className="panel panel-wide">
              <div className="panel-head">
                <h2>Umsatz nach Bundle</h2>
                <span className="panel-note">
                  Anteil je Projekt am Bundle · {revenueBillings.length} Projekte
                </span>
              </div>

              <div className="bundle-grid">
                {byBundle.map(group => {
                  const share = (value: number) =>
                    group.total > 0 ? (value / group.total) * 100 : 0

                  return (
                    <article className="bundle-card" key={group.bundleId}>
                      <header className="bundle-card-head">
                        <h3 title={group.name}>{group.name}</h3>
                        <div className="bundle-card-total">{currency(group.total)}</div>
                        <div className="bundle-card-meta">
                          {group.rows.length} Projekt{group.rows.length === 1 ? '' : 'e'}
                        </div>
                      </header>

                      {/* Alle Projekte, eine Zeile je Projekt - der Betrag steht
                          im Tooltip und in der Tabelle darunter. */}
                      <ul className="share-list">
                        {group.rows.map(row => (
                          <li
                            className="share-row"
                            key={row.projectName}
                            title={`${row.projectName}: ${currency(row.betrag, 2)} · ${share(row.betrag).toFixed(1)} % von ${group.name}`}
                          >
                            <div className="share-head">
                              <span className="share-name">{row.projectName}</span>
                              <span className="share-pct">
                                {share(row.betrag).toLocaleString('de-DE', {
                                  minimumFractionDigits: 1,
                                  maximumFractionDigits: 1,
                                })}
                                {' %'}
                              </span>
                            </div>
                            <div className="share-foot">
                              {/* Volle Breite: bei schmaler Spur waere ein Anteil
                                  von 1,4 % nur noch ein Punkt. */}
                              <span className="share-track" aria-hidden="true">
                                <span
                                  className="share-fill"
                                  style={{ width: `${Math.max(0.8, share(row.betrag))}%` }}
                                />
                              </span>
                              {/* Der Betrag wird in ein anderes System uebertragen -
                                  er muss ablesbar sein, nicht nur im Tooltip stehen. */}
                              <span className="share-eur">{currency(row.betrag)}</span>
                            </div>
                          </li>
                        ))}
                      </ul>
                    </article>
                  )
                })}
              </div>
            </section>

            <section className="panel">
              <div className="panel-head">
                <h2>Umsatz nach Rolle</h2>
                <span className="panel-note">{roleRevenue.size} Rollen</span>
              </div>
              <BarList
                rows={Array.from(roleRevenue.entries())
                  .sort((a, b) => b[1] - a[1])
                  .map(([roleLabel, amount]) => ({
                    key: roleLabel,
                    label: roleLabel,
                    value: amount,
                    display: currency(amount),
                    title: `${roleLabel}: ${currency(amount, 2)} · ${((amount / totalRevenue) * 100).toFixed(1)} %`,
                  }))}
                max={maxRoleRevenue}
              />
            </section>

            {trend.length > 1 && (
              <section className="panel panel-wide">
                <div className="panel-head">
                  <h2>Blended Rate im Verlauf</h2>
                  <span className="panel-note">letzte {trend.length} Monate</span>
                </div>
                <TrendChart
                  points={trend.map(t => ({
                    month: t.month,
                    label: formatMonth(t.month),
                    value: t.rate,
                    note: `${currency(t.betrag)} Umsatz`,
                  }))}
                />
              </section>
            )}

            {unproductive && unproductive.totalHours > 0 && (
              <section className="panel panel-wide">
                <div className="panel-head">
                  <h2>Nicht fakturierbare Zeiten</h2>
                  <span className="panel-note">
                    {formatHours(unproductive.totalHours)} Std ·{' '}
                    {unproductive.share.toFixed(1)} % der erbrachten Leistung
                  </span>
                </div>
                <div className="split">
                  <div>
                    <h3 className="sub-head">Nach Projekt</h3>
                    <BarList
                      muted
                      rows={unproductive.byProject.map(row => ({
                        key: row.projectName,
                        label: row.projectName,
                        value: row.hours,
                        display: `${formatHours(row.hours)} Std`,
                        title: `${row.projectName}: ${formatHours(row.hours)} Std`,
                      }))}
                      max={unproductive.byProject[0]?.hours ?? 1}
                    />
                  </div>
                  <div>
                    <h3 className="sub-head">Nach Mitarbeiter</h3>
                    <BarList
                      muted
                      rows={unproductive.byEmployee.slice(0, 10).map(row => ({
                        key: row.resource,
                        label: row.resource,
                        value: row.hours,
                        display: `${formatHours(row.hours)} Std`,
                        title: `${row.resource}: ${formatHours(row.hours)} Std`,
                      }))}
                      max={unproductive.byEmployee[0]?.hours ?? 1}
                    />
                    {unproductive.byEmployee.length > 10 && (
                      <p className="chart-footnote">
                        {unproductive.byEmployee.length - 10} weitere mit geringerem Anteil
                      </p>
                    )}
                  </div>
                </div>
              </section>
            )}

            <section className="panel panel-wide">
              <div className="panel-head">
                <h2>Projekt Details</h2>
                <span className="panel-note">alle Werte des Monats</span>
              </div>
              <div className="dashboard-table-wrapper">
                <table className="dashboard-table">
                  <thead>
                    <tr>
                      <th>Projekt</th>
                      <th>PO</th>
                      <th className="numeric">Stunden</th>
                      <th className="numeric">Tage</th>
                      <th className="numeric">Nicht fakt.</th>
                      <th className="numeric">Blended Rate</th>
                      <th className="numeric">Umsatz</th>
                    </tr>
                  </thead>
                  <tbody>
                    {billings.map(billing => (
                      <tr key={billing.projectName}>
                        <td>{billing.projectName}</td>
                        <td>
                          {billing.purchaseOrder ?? <span className="dashboard-missing">fehlt</span>}
                        </td>
                        <td className="numeric">{formatHours(billing.hours)}</td>
                        <td className="numeric">{formatDays(billing.days)}</td>
                        <td className="numeric">
                          {billing.nonChargeable.hours > 0
                            ? formatHours(billing.nonChargeable.hours)
                            : '—'}
                        </td>
                        <td className="numeric">{currency(billing.blendedRate)}</td>
                        <td className="numeric strong">{currency(billing.betrag)}</td>
                      </tr>
                    ))}
                    <tr className="dashboard-table-total">
                      <td colSpan={2}>Gesamt</td>
                      <td className="numeric">{formatHours(totalHours)}</td>
                      <td className="numeric">{formatDays(totalDays)}</td>
                      <td className="numeric">
                        {nonChargeableHours > 0 ? formatHours(nonChargeableHours) : '—'}
                      </td>
                      <td className="numeric">{currency(overallBlendedRate)}</td>
                      <td className="numeric strong">{currency(totalRevenue)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  )
}

/** Kennzahl. Der Wert steht vorn, die Bezeichnung ordnet ihn ein. */
function StatTile({
  label,
  value,
  note,
  accent,
  meter,
}: {
  label: string
  value: string
  note?: string
  accent?: boolean
  meter?: number
}) {
  return (
    <div className={`stat${accent ? ' stat-accent' : ''}`}>
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {/* Ein Anteil laesst sich als Balken schneller erfassen als als Zahl */}
      {meter !== undefined && (
        <div className="stat-meter" role="presentation">
          <div className="stat-meter-fill" style={{ width: `${Math.min(100, meter)}%` }} />
        </div>
      )}
      {note && <div className="stat-note">{note}</div>}
    </div>
  )
}

interface BarRow {
  key: string
  label: string
  sublabel?: string
  value: number
  display: string
  title: string
}

/**
 * Liegende Balken fuer Groessenvergleiche.
 *
 * Eine Reihe je Diagramm - deshalb keine Legende, der Titel benennt sie. Der Wert
 * steht direkt am Balken statt auf einer Achse.
 */
function BarList({ rows, max, muted }: { rows: BarRow[]; max: number; muted?: boolean }) {
  if (rows.length === 0) return <p className="chart-footnote">Keine Daten.</p>

  return (
    <div className="bars">
      {rows.map(row => (
        <div className="bar-row" key={row.key} title={row.title}>
          <div className="bar-label">
            {row.label}
            {row.sublabel && <span className="bar-sublabel">{row.sublabel}</span>}
          </div>
          <div className="bar-track">
            <div
              className={`bar-fill${muted ? ' bar-fill-muted' : ''}`}
              style={{ width: `${Math.max(1.5, (row.value / max) * 100)}%` }}
            />
          </div>
          <div className="bar-value">{row.display}</div>
        </div>
      ))}
    </div>
  )
}

interface TrendPoint {
  month: string
  label: string
  value: number
  note: string
}

/**
 * Zeitreihe als Linie.
 *
 * Vorher standen die Monate als liegende Balken untereinander - eine Form fuer
 * Groessenvergleiche, nicht fuer Verlaeufe. Eine Linie zeigt die Richtung.
 */
function TrendChart({ points }: { points: TrendPoint[] }) {
  const width = 720
  const height = 190
  const pad = { top: 16, right: 16, bottom: 30, left: 56 }

  const values = points.map(p => p.value)
  const rawMax = Math.max(...values)
  const rawMin = Math.min(...values)
  const rawSpan = rawMax - rawMin

  // Liegen die Werte dicht beieinander, wuerde eine auf den Bereich gespannte Achse
  // winzige Schwankungen zu Bergen aufblasen und alle Ticks auf dieselbe Zahl runden.
  // Dann lieber einen Mindestbereich aufspannen - die Linie bleibt flach, was sie ist.
  const span = rawSpan < rawMax * 0.02 ? Math.max(rawMax * 0.1, 1) : rawSpan
  const max = rawMax + span * 0.15
  const min = Math.max(0, rawMin - span * 0.15)

  // Nachkommastellen so waehlen, dass die Ticks unterscheidbar bleiben
  const tickSpan = max - min
  const tickDigits = tickSpan >= 50 ? 0 : tickSpan >= 5 ? 1 : 2
  const formatTick = (v: number) =>
    v.toLocaleString('de-DE', {
      minimumFractionDigits: tickDigits,
      maximumFractionDigits: tickDigits,
    })

  const x = (i: number) =>
    pad.left + (i * (width - pad.left - pad.right)) / Math.max(1, points.length - 1)
  const y = (v: number) =>
    pad.top + (1 - (v - min) / (max - min || 1)) * (height - pad.top - pad.bottom)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(i)} ${y(p.value)}`).join(' ')
  const area =
    `M ${x(0)} ${height - pad.bottom} ` +
    points.map((p, i) => `L ${x(i)} ${y(p.value)}`).join(' ') +
    ` L ${x(points.length - 1)} ${height - pad.bottom} Z`

  const ticks = [min, (min + max) / 2, max]

  return (
    <div className="trend">
      <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Blended Rate im Verlauf">
        {/* Zurueckhaltendes Gitter - Orientierung, keine Konkurrenz zur Linie */}
        {ticks.map(t => (
          <g key={t}>
            <line
              x1={pad.left}
              x2={width - pad.right}
              y1={y(t)}
              y2={y(t)}
              className="trend-grid"
            />
            <text x={pad.left - 8} y={y(t) + 4} className="trend-tick" textAnchor="end">
              {formatTick(t)}
            </text>
          </g>
        ))}

        <path d={area} className="trend-area" />
        <path d={line} className="trend-line" />

        {points.map((p, i) => (
          <g key={p.month}>
            <circle cx={x(i)} cy={y(p.value)} r={5} className="trend-dot" />
            <title>{`${p.label}: € ${Math.round(p.value).toLocaleString('de-DE')} je Tag · ${p.note}`}</title>
            <text
              x={x(i)}
              y={height - 10}
              className="trend-xlabel"
              /* Erste und letzte Beschriftung an den Rand binden, sonst laeuft sie
                 ueber die Zeichenflaeche hinaus */
              textAnchor={i === 0 ? 'start' : i === points.length - 1 ? 'end' : 'middle'}
            >
              {p.label.replace(/ \d{4}$/, '')}
            </text>
          </g>
        ))}

        {/* Nur den letzten Wert beschriften - eine Zahl an jedem Punkt waere Rauschen.
            Faellt die Linie in den Punkt hinein, kommt sie von oben: dann gehoert die
            Beschriftung darunter, sonst darueber. */}
        {(() => {
          const last = points[points.length - 1]
          const previous = points[points.length - 2]
          const descending = previous ? last.value < previous.value : false
          return (
            <text
              x={x(points.length - 1)}
              y={y(last.value) + (descending ? 20 : -14)}
              className="trend-endlabel"
              textAnchor="end"
            >
              € {formatTick(last.value)}
            </text>
          )
        })()}
      </svg>
    </div>
  )
}
