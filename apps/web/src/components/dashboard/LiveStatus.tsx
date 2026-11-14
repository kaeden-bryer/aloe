/**
 * "Working now" strip. The four steps mirror the task lifecycle
 * (see packages/core/src/states.ts): Claimed -> Working -> Verify -> Merge.
 */
import type { ReactNode } from "react";
import type { Dashboard } from "@aloe/core/contracts";
import { CheckIcon } from "../Icons";

const STEPS = [
  { stage: "claimed", label: "Claimed" },
  { stage: "working", label: "Working" },
  { stage: "verify", label: "Verify" },
  { stage: "merge", label: "Merge" },
] as const;

export function LiveStatus({ live, paused }: { live: Dashboard["live"]; paused: boolean }) {
  if (paused) {
    return (
      <Strip label="Paused" title="Your agent is paused" sub="It finished its last task. Resume in Settings whenever you like." on={false} />
    );
  }
  if (!live) {
    return <Strip label="Idle" title="Waiting for a task" sub="Your agent picks up the next task in your donation window." on={false} />;
  }

  const current = STEPS.findIndex((s) => s.stage === live.stage);
  return (
    <Strip label="Working now" title={live.title} sub={`${live.projectEmoji} ${live.projectName} · ${live.sub}`} on>
      <ol aria-label="Task progress" className="steps">
        {STEPS.map((s, i) => {
          const state = i < current ? "is-done" : i === current ? "is-current" : "";
          return [
            i > 0 && <li key={s.stage + "-line"} aria-hidden="true" className="step-line" />,
            <li key={s.stage} className={`step ${state}`} aria-current={i === current ? "step" : undefined}>
              <span className={i === current ? "step-mark pulse" : "step-mark"}>{i < current && <CheckIcon size={11} />}</span>
              {s.label}
            </li>,
          ];
        })}
      </ol>
    </Strip>
  );
}

function Strip({ label, title, sub, on, children }: { label: string; title: string; sub: string; on: boolean; children?: ReactNode }) {
  return (
    <div className="panel live">
      <div className="live-main">
        <div className="live-label">
          <span className={on ? "live-dot is-on pulse" : "live-dot"} />
          {label}
        </div>
        <div className="live-title">{title}</div>
        <div className="live-sub">{sub}</div>
      </div>
      {children}
    </div>
  );
}
