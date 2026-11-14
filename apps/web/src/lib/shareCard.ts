/**
 * Layout for the 1200x630 share image. PURE: no canvas, no DOM. It receives a
 * `measure` function (the real one wraps canvas measureText; tests pass a fake),
 * so we can unit-test truncation and positions without a browser.
 * The drawing code (shareCardRender.ts) just paints whatever this returns.
 */
import type { Dashboard } from "@aloe/core/contracts";

export const CARD_W = 1200;
export const CARD_H = 630;
const PAD = 72;

export interface CardData {
  weekLabel: string;
  merged: number;
  projects: { emoji: string; name: string }[];
  /** Merges per day, oldest first (for the tiny bar chart). */
  perDay: { label: string; total: number }[];
}

export type Measure = (text: string, size: number, weight: number) => number;

export interface TextItem {
  text: string;
  x: number;
  y: number; // alphabetic baseline
  size: number;
  weight: number;
  color: string;
  align?: "left" | "center";
  letterSpacing?: number;
}
export interface PillItem { x: number; y: number; w: number; h: number; text: TextItem; more: boolean }
export interface BarItem { x: number; y: number; w: number; h: number; label: TextItem; peak: boolean }
export interface CardLayout { texts: TextItem[]; pills: PillItem[]; bars: BarItem[]; logo: { x: number; y: number; size: number } }

export function cardDataFrom(dash: Pick<Dashboard, "weekLabel" | "landed" | "mergedPerDay">): CardData {
  return {
    weekLabel: dash.weekLabel,
    merged: dash.landed.reduce((s, p) => s + p.merged, 0),
    projects: dash.landed.map((p) => ({ emoji: p.emoji, name: p.name })),
    perDay: dash.mergedPerDay.map((d) => ({ label: d.label, total: d.total })),
  };
}

/** Shortens `text` with an ellipsis until it fits `maxW`. */
export function truncate(text: string, maxW: number, size: number, weight: number, measure: Measure): string {
  if (measure(text, size, weight) <= maxW) return text;
  // Spread into code points so we never cut an emoji in half.
  const chars = [...text];
  while (chars.length > 1 && measure(chars.join("").trimEnd() + "…", size, weight) > maxW) chars.pop();
  return chars.join("").trimEnd() + "…";
}

const PILL = { h: 56, gap: 14, size: 26, padX: 22, top: 450, maxRows: 2 };

/** Flows labels left-to-right, wrapping; returns null if they need more than maxRows. */
function flowPills(labels: { text: string; more: boolean }[], measure: Measure): PillItem[] | null {
  const maxRight = CARD_W - PAD;
  const out: PillItem[] = [];
  let x = PAD, row = 0;
  for (const l of labels) {
    const w = measure(l.text, PILL.size, 500) + PILL.padX * 2;
    if (x + w > maxRight) { row++; x = PAD; }
    if (row >= PILL.maxRows) return null;
    const y = PILL.top + row * (PILL.h + PILL.gap);
    out.push({
      x, y, w, h: PILL.h, more: l.more,
      text: { text: l.text, x: x + PILL.padX, y: y + 37, size: PILL.size, weight: 500, color: l.more ? "#8fe3aa" : "#ffffff" },
    });
    x += w + PILL.gap;
  }
  return out;
}

export function layoutCard(data: CardData, measure: Measure): CardLayout {
  const texts: TextItem[] = [];
  const n = data.projects.length;

  texts.push({ text: "Aloe", x: PAD + 56, y: 91, size: 34, weight: 700, color: "#ffffff" });
  texts.push({
    text: truncate("MY SPARE AI CAPACITY · " + data.weekLabel.toUpperCase(), 620, 22, 600, measure),
    x: PAD, y: 196, size: 22, weight: 600, color: "#8fe3aa", letterSpacing: 2,
  });

  // The hero number; the caption sits to its right, so we measure the number first.
  const big = String(data.merged);
  const bigW = measure(big, 150, 700);
  texts.push({ text: big, x: PAD, y: 330, size: 150, weight: 700, color: "#ffffff", letterSpacing: -5 });
  const capX = PAD + bigW + 28;
  texts.push({ text: "verified", x: capX, y: 278, size: 40, weight: 600, color: "#ffffff" });
  texts.push({ text: data.merged === 1 ? "improvement" : "improvements", x: capX, y: 326, size: 40, weight: 600, color: "#ffffff" });

  texts.push({
    text: truncate(
      "shipped to " + n + (n === 1 ? " open-source project" : " open-source projects") + ", on spare AI.", // short on purpose: the bar chart owns the right side of the card
      640, 26, 400, measure,
    ),
    x: PAD, y: 384, size: 26, weight: 400, color: "rgba(255,255,255,0.78)",
  });

  // Tiny chart on the right: bars share one baseline; the tallest day is highlighted.
  const bars: BarItem[] = [];
  const chartX = 760, chartW = 368, base = 330, top = 150;
  const slot = chartW / Math.max(1, data.perDay.length);
  const barW = Math.min(36, slot - 12);
  const max = Math.max(1, ...data.perDay.map((d) => d.total));
  data.perDay.forEach((d, i) => {
    // Zero days still get a 4px stub so the week reads as seven days, not a gap.
    const h = d.total === 0 ? 4 : Math.max(8, Math.round((d.total / max) * (base - top)));
    const cx = chartX + slot * i + slot / 2;
    bars.push({
      x: cx - barW / 2, y: base - h, w: barW, h, peak: d.total === max && d.total > 0,
      label: { text: d.label.slice(0, 3), x: cx, y: base + 34, size: 20, weight: 500, color: "rgba(255,255,255,0.6)", align: "center" },
    });
  });

  // Project pills: at most two rows. If they don't all fit, keep as many as
  // possible and end with a "+N more" pill so nothing runs off the card.
  const maxText = CARD_W - PAD * 2 - PILL.padX * 2;
  const labels = data.projects.map((p) => ({ text: truncate(p.emoji + " " + p.name, maxText, PILL.size, 500, measure), more: false }));
  let pills = flowPills(labels, measure);
  for (let k = n - 1; !pills && k >= 0; k--) {
    pills = flowPills([...labels.slice(0, k), { text: "+" + (n - k) + " more", more: true }], measure);
  }

  return { texts, pills: pills ?? [], bars, logo: { x: PAD, y: 62, size: 44 } };
}
