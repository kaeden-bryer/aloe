/**
 * The demo's "human clicks once" moment: a maintainer picks one option and
 * the steward carries on. Each option is a real button that resolves the
 * decision through the API.
 */
import type { Decision } from "@aloe/core/contracts";
import { useResolveDecision } from "../api/hooks";
import { useToast } from "./Toast";

export function DecisionOptions({ decision }: { decision: Decision }) {
  const resolve = useResolveDecision();
  const flash = useToast();

  return (
    <div className="decision-options" role="group" aria-label="Maintainer decision">
      {decision.options.map((o, i) => (
        <button
          key={o.id}
          type="button"
          className={i === 0 ? "decision-btn is-first" : "decision-btn"}
          disabled={resolve.isPending}
          onClick={() =>
            resolve.mutate(
              { id: decision.id, optionId: o.id },
              {
                onSuccess: () => flash(`Decided: ${o.label}`),
                onError: () => flash("Could not save that decision. Try again."),
              },
            )
          }
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
