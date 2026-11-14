import { describe, expect, it } from "vitest";
import { CARD_W, cardDataFrom, layoutCard, truncate, type CardData } from "../lib/shareCard";

// Fake text measurer: every character is size*0.5 px wide, so tests need no canvas.
const measure = (t: string, size: number) => [...t].length * size * 0.5;

const data = (over: Partial<CardData> = {}): CardData => ({
  weekLabel: "Nov 8 - 14",
  merged: 14,
  projects: [{ emoji: "🌱", name: "Solar Map" }, { emoji: "💧", name: "Water Watch" }],
  perDay: [0, 2, 3, 1, 4, 2, 2].map((total, i) => ({ label: "Day" + i, total })),
  ...over,
});

describe("truncate", () => {
  it("leaves short text alone", () => expect(truncate("hi", 100, 10, 400, measure)).toBe("hi"));
  it("adds an ellipsis and fits", () => {
    const out = truncate("a very long project name", 60, 10, 400, measure);
    expect(out.endsWith("…")).toBe(true);
    expect(measure(out, 10)).toBeLessThanOrEqual(60);
  });
  it("does not split emoji", () => expect(truncate("🌱🌱🌱🌱🌱🌱", 15, 10, 400, measure)).toBe("🌱🌱…"));
});

describe("layoutCard", () => {
  it("places the merged count and pluralises", () => {
    expect(layoutCard(data(), measure).texts.map((t) => t.text)).toContain("improvements");
    expect(layoutCard(data({ merged: 1 }), measure).texts.map((t) => t.text)).toContain("improvement");
  });
  it("makes one bar per day, tallest highlighted, zero days still visible", () => {
    const { bars } = layoutCard(data(), measure);
    expect(bars).toHaveLength(7);
    expect(bars.filter((b) => b.peak)).toHaveLength(1);
    expect(bars[0]!.h).toBe(4);
  });
  it("keeps every pill inside the card and truncates a giant name", () => {
    const { pills } = layoutCard(data({ projects: [{ emoji: "🌍", name: "x".repeat(400) }] }), measure);
    expect(pills).toHaveLength(1);
    expect(pills[0]!.x + pills[0]!.w).toBeLessThanOrEqual(CARD_W - 72);
    expect(pills[0]!.text.text.endsWith("…")).toBe(true);
  });
  it("collapses overflow into a '+N more' pill within two rows", () => {
    const projects = Array.from({ length: 20 }, (_, i) => ({ emoji: "🌱", name: "Project number " + i }));
    const { pills } = layoutCard(data({ projects }), measure);
    expect(new Set(pills.map((p) => p.y)).size).toBeLessThanOrEqual(2);
    expect(pills.at(-1)!.text.text).toMatch(/^\+\d+ more$/);
    for (const p of pills) expect(p.x + p.w).toBeLessThanOrEqual(CARD_W - 72);
  });
  it("shows all projects when they fit", () => {
    expect(layoutCard(data(), measure).pills.some((p) => p.more)).toBe(false);
  });
});

describe("cardDataFrom", () => {
  it("sums merged across projects", () => {
    const c = cardDataFrom({
      weekLabel: "w",
      landed: [
        { projectId: "a", name: "A", emoji: "x", merged: 3, share: 1, released: false },
        { projectId: "b", name: "B", emoji: "y", merged: 4, share: 1, released: false },
      ],
      mergedPerDay: [],
    });
    expect(c.merged).toBe(7);
  });
});
