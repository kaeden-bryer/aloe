import { PILL_STYLE, type PillTone } from "../lib/catalog";

export function StatusPill({ tone, children }: { tone: PillTone; children: string }) {
  return (
    <span className="pill" style={PILL_STYLE[tone]}>
      {children}
    </span>
  );
}
