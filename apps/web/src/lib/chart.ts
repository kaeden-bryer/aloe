import type { Dashboard } from "@aloe/core/contracts";

/** Plot height in px; matches the 180px grid in the design. */
export const PLOT_HEIGHT = 180;

/**
 * The y-axis top: the tallest day rounded up to an even number (so the middle
 * gridline lands on a whole number), and never less than 2.
 */
export function yAxisMax(totals: number[]): number {
  const max = Math.max(0, ...totals);
  return Math.max(2, max % 2 ? max + 1 : max);
}

export interface ChartSegment {
  projectId: string;
  n: number;
  /** Pixel height; 2px is taken off each segment for the gap between them. */
  height: number;
}

export interface ChartDay {
  label: string;
  long: string;
  total: number;
  segments: ChartSegment[];
}

/** Turns the API's per-day counts into pixel segments for the stacked bars. */
export function buildChart(days: Dashboard["mergedPerDay"], plot = PLOT_HEIGHT) {
  const max = yAxisMax(days.map((d) => d.total));
  return {
    max,
    mid: max / 2,
    days: days.map<ChartDay>((d) => ({
      label: d.label,
      long: d.long,
      total: d.total,
      segments: Object.entries(d.byProject)
        .filter(([, n]) => n > 0)
        .map(([projectId, n]) => ({ projectId, n, height: Math.round((n / max) * plot - 2) })),
    })),
  };
}
