/**
 * The hero's interactive pixel field: moving the cursor leaves a trail of
 * glowing cells, clicking sends out a ring ("bloom"), and a few cells sparkle
 * on their own so the hero feels alive before anyone touches it.
 *
 * It listens on its parent element (the hero section), because the canvas
 * itself has pointer-events: none so it never blocks the buttons above it.
 */
import { useEffect, useRef } from "react";

const GRID = 14; // cell size in CSS px
const PALETTE = ["#E6F7EC", "#C7F2D4", "#A8E6BD", "#8FE3AA", "#5FBF83", "#F1F5C4"];

interface Cell {
  x: number;
  y: number;
  /** Energy: brightness that decays to 0, at which point the cell is removed. */
  e: number;
  col: string;
  decay: number;
}

interface Burst {
  cx: number;
  cy: number;
  r: number;
}

export function PixelBloomCanvas() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // Why refs instead of state: pointer moves arrive dozens of times per second.
  // Storing cells in useState would re-render this component on every move;
  // refs are plain mutable boxes, so the rAF loop reads and draws them directly.
  const cells = useRef(new Map<string, Cell>());
  const bursts = useRef<Burst[]>([]);
  const last = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    // Respect the OS "reduce motion" setting: draw nothing and ignore input.
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    if (reduce) return;

    const light = (cx: number, cy: number, energy: number) => {
      const key = cx + "," + cy;
      const cur = cells.current.get(key);
      if (cur) {
        cur.e = Math.max(cur.e, energy);
        return;
      }
      cells.current.set(key, {
        x: cx,
        y: cy,
        e: energy,
        col: PALETTE[Math.floor(Math.random() * PALETTE.length)]!,
        decay: 1.3 + Math.random() * 0.9,
      });
    };

    const splat = (cx: number, cy: number, radius: number) => {
      const R = Math.ceil(radius);
      for (let dx = -R; dx <= R; dx++) {
        for (let dy = -R; dy <= R; dy++) {
          const d = Math.hypot(dx, dy);
          if (d > radius) continue;
          if (Math.random() < 1 - d / (radius + 0.4)) light(cx + dx, cy + dy, 1 - d * 0.22 + Math.random() * 0.15);
        }
      }
    };

    const onMove = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const from = last.current ?? { x, y };
      // Fill in the gap between two events so fast moves still draw a solid trail.
      const steps = Math.max(1, Math.ceil(Math.hypot(x - from.x, y - from.y) / (GRID * 0.6)));
      for (let i = 1; i <= steps; i++) {
        const px = from.x + (x - from.x) * (i / steps);
        const py = from.y + (y - from.y) * (i / steps);
        splat(Math.floor(px / GRID), Math.floor(py / GRID), 2.4);
      }
      last.current = { x, y };
    };
    const onLeave = () => {
      last.current = null;
    };
    const onClick = (e: MouseEvent) => {
      const r = canvas.getBoundingClientRect();
      bursts.current.push({ cx: Math.floor((e.clientX - r.left) / GRID), cy: Math.floor((e.clientY - r.top) / GRID), r: 0 });
    };

    let raf = 0;
    let prev = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min(0.05, (now - (prev || now)) / 1000);
      prev = now;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      if (!w || !h) return;

      // Match the backing store to the CSS size (capped at 2x) so cells stay crisp.
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      // Ambient sparkles.
      if (Math.random() < dt * 5) {
        light(Math.floor(Math.random() * (w / GRID)), Math.floor(Math.random() * (h / GRID)), 0.35 + Math.random() * 0.2);
      }

      // Click bursts: an expanding ring of pixels.
      bursts.current = bursts.current.filter((b) => {
        b.r += dt * 26;
        const R = Math.ceil(b.r) + 1;
        for (let dx = -R; dx <= R; dx++) {
          for (let dy = -R; dy <= R; dy++) {
            const d = Math.hypot(dx, dy);
            if (Math.abs(d - b.r) < 0.7 && Math.random() < 0.55) light(b.cx + dx, b.cy + dy, 1.1 - b.r / 14);
          }
        }
        return b.r < 12;
      });

      cells.current.forEach((c, key) => {
        c.e -= dt * c.decay;
        if (c.e <= 0) {
          cells.current.delete(key);
          return;
        }
        ctx.globalAlpha = Math.min(1, c.e) * 0.9;
        ctx.fillStyle = c.col;
        ctx.fillRect(c.x * GRID + 1, c.y * GRID + 1, GRID - 2, GRID - 2);
      });
      ctx.globalAlpha = 1;
    };

    host.addEventListener("pointermove", onMove);
    host.addEventListener("pointerleave", onLeave);
    host.addEventListener("click", onClick);
    raf = requestAnimationFrame(tick);

    // Cleanup runs on unmount (e.g. navigating away from the landing page):
    // stop the loop and drop the listeners so nothing leaks.
    return () => {
      cancelAnimationFrame(raf);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
      host.removeEventListener("click", onClick);
    };
  }, []);

  return <canvas ref={canvasRef} className="hero-canvas" aria-hidden="true" />;
}
