/**
 * Paints a CardLayout onto an offscreen canvas and returns a PNG Blob.
 * No dependencies: Canvas 2D works in mock mode and needs no server.
 */
import { CARD_H, CARD_W, layoutCard, type CardData, type Measure, type TextItem } from "./shareCard";

const FONT = '"Inter", system-ui, -apple-system, "Segoe UI", sans-serif';
// Emoji fonts come last so project emoji render in color on every OS.
const font = (size: number, weight: number) => `${weight} ${size}px ${FONT}, "Apple Color Emoji", "Segoe UI Emoji", "Noto Color Emoji"`;

function drawText(ctx: CanvasRenderingContext2D, t: TextItem) {
  ctx.font = font(t.size, t.weight);
  ctx.fillStyle = t.color;
  ctx.textAlign = t.align ?? "left";
  // letterSpacing is supported by modern canvases; older ones just ignore it.
  (ctx as unknown as { letterSpacing: string }).letterSpacing = (t.letterSpacing ?? 0) + "px";
  ctx.fillText(t.text, t.x, t.y);
  (ctx as unknown as { letterSpacing: string }).letterSpacing = "0px";
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** The Aloe mark from Icons.tsx, drawn with the same path data via Path2D. */
function drawLogo(ctx: CanvasRenderingContext2D, x: number, y: number, size: number) {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 32, size / 32);
  ctx.fillStyle = "#2F7D4F";
  roundRect(ctx, 0, 0, 32, 32, 8);
  ctx.fill();
  ctx.fillStyle = "#DFF0E4";
  ctx.fill(new Path2D("M16 25 C 13 18, 13.5 11, 16 5 C 18.5 11, 19 18, 16 25 Z"));
  ctx.fillStyle = "#B7DCC3";
  ctx.fill(new Path2D("M15 25 C 11 22, 8 18, 6.5 12.5 C 10.5 15, 13.5 19, 15 25 Z"));
  ctx.fill(new Path2D("M17 25 C 21 22, 24 18, 25.5 12.5 C 21.5 15, 18.5 19, 17 25 Z"));
  ctx.restore();
}

/** Same decorative pixel grid as the on-screen preview. */
const PIXELS: ([string, number] | null)[] = [
  ["#8FE3AA", 1], null, ["#C7F2D4", 0.6], null, ["#5FBF83", 1], ["#8FE3AA", 0.4],
  null, ["#5FBF83", 0.7], null, ["#A8E6BD", 1], null, ["#C7F2D4", 0.5],
  ["#A8E6BD", 0.5], null, ["#8FE3AA", 1], null, null, ["#5FBF83", 1],
];

export async function renderShareCard(data: CardData, opts: { scale?: number } = {}): Promise<Blob> {
  // Without this, canvas would silently fall back to a system font if Inter hasn't loaded yet.
  if (document.fonts) {
    await Promise.all([400, 500, 600, 700].map((w) => document.fonts.load(font(20, w)).catch(() => [])));
    await document.fonts.ready;
  }
  // Draw at 2x (or the screen's ratio) so text stays crisp when shown big or retina-scaled.
  const scale = opts.scale ?? Math.max(2, Math.ceil(window.devicePixelRatio || 1));
  const canvas = document.createElement("canvas");
  canvas.width = CARD_W * scale;
  canvas.height = CARD_H * scale;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas is not available");
  ctx.scale(scale, scale);
  ctx.textBaseline = "alphabetic";

  const measure: Measure = (text, size, weight) => {
    ctx.font = font(size, weight);
    return ctx.measureText(text).width;
  };
  const layout = layoutCard(data, measure);

  // Background: deep forest with a soft green glow in the top-right.
  ctx.fillStyle = "#0c1811";
  ctx.fillRect(0, 0, CARD_W, CARD_H);
  const glow = ctx.createRadialGradient(1050, 60, 0, 1050, 60, 620);
  glow.addColorStop(0, "rgba(47,125,79,0.55)");
  glow.addColorStop(1, "rgba(47,125,79,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, CARD_W, CARD_H);

  PIXELS.forEach((p, i) => {
    if (!p) return;
    ctx.globalAlpha = p[1];
    ctx.fillStyle = p[0];
    ctx.fillRect(1128 - 5 * 22 + (i % 6) * 22, 56 + Math.floor(i / 6) * 22, 18, 18);
  });
  ctx.globalAlpha = 1;

  drawLogo(ctx, layout.logo.x, layout.logo.y, layout.logo.size);

  for (const b of layout.bars) {
    ctx.fillStyle = b.peak ? "#8FE3AA" : "rgba(143,227,170,0.38)";
    roundRect(ctx, b.x, b.y, b.w, b.h, 6);
    ctx.fill();
    drawText(ctx, b.label);
  }

  for (const p of layout.pills) {
    roundRect(ctx, p.x, p.y, p.w, p.h, p.h / 2);
    ctx.fillStyle = "rgba(255,255,255,0.1)";
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.18)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
    drawText(ctx, p.text);
  }
  for (const t of layout.texts) drawText(ctx, t);

  return new Promise((resolve, reject) => {
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("Could not encode PNG"))), "image/png");
  });
}
