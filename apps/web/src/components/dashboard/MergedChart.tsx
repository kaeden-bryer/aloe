/**
 * "Merged per day" stacked bar chart, built from plain divs like the design.
 * Bars are buttons so keyboard users can focus a day and get the tooltip too.
 */
import { useState } from "react";
import type { Dashboard } from "@aloe/core/contracts";
import { projectColor } from "../../lib/catalog";
import { buildChart, PLOT_HEIGHT } from "../../lib/chart";

export function MergedChart({ days, names }: { days: Dashboard["mergedPerDay"]; names: Map<string, string> }) {
  const [hover, setHover] = useState(-1);
  const chart = buildChart(days);
  const todayIdx = days.length - 1; // the API sends the last 7 days, oldest first

  return (
    <div className="chart">
      <div className="chart-axis" aria-hidden="true">
        <span style={{ top: -8 }}>{chart.max}</span>
        <span style={{ top: PLOT_HEIGHT / 2 - 8 }}>{chart.mid}</span>
        <span style={{ bottom: -8 }}>0</span>
      </div>
      <div className="chart-plot">
        <div className="gridline" aria-hidden="true" style={{ top: 0 }} />
        <div className="gridline" aria-hidden="true" style={{ top: PLOT_HEIGHT / 2 }} />
        <div className="gridline is-base" aria-hidden="true" style={{ top: PLOT_HEIGHT }} />
        <div className="chart-cols">
          {chart.days.map((d, i) => (
            <div key={d.long} className="chart-col">
              <button
                type="button"
                className={hover === i ? "chart-hit is-hovered" : "chart-hit"}
                aria-label={`${d.long}: ${d.total} merged`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(-1)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(-1)}
              >
                <span className="chart-bar">
                  {d.segments.map((s) => (
                    <span key={s.projectId} style={{ height: s.height, background: projectColor(s.projectId) }} />
                  ))}
                </span>
              </button>
              <span className={i === todayIdx ? "chart-label is-today" : "chart-label"}>{d.label}</span>
              {hover === i && (
                <div role="tooltip" className="tooltip">
                  <div style={{ fontWeight: 600 }}>{d.long}</div>
                  {d.segments.map((s) => (
                    <div key={s.projectId} className="tooltip-row">
                      <span className="swatch" style={{ width: 9, height: 9, borderRadius: 2, background: projectColor(s.projectId) }} />
                      <span className="n">{names.get(s.projectId) ?? s.projectId}</span>
                      <span className="v">{s.n}</span>
                    </div>
                  ))}
                  <div className="tooltip-total">
                    <span className="k">Total merged</span>
                    <span className="v">{d.total}</span>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
