import { useInbox, useResolveInbox } from "../../api/maintainer";
import { WarningIcon } from "../../components/Icons";
import { useToast } from "../../components/Toast";

/** Every open escalation for this project, resolvable in place (same logic as the donor-side route). */
export function DecisionsTab({ projectId }: { projectId: string }) {
  const flash = useToast();
  const { data, isPending } = useInbox(projectId);
  const resolve = useResolveInbox(projectId);

  if (isPending) return <p className="loading">Loading decisions…</p>;
  if (!data?.length) return <p className="maintain-empty">Nothing waiting on you. The steward is handling the queue.</p>;

  return (
    <div>
      {data.map((d) => (
        <div key={d.id} className="escalated">
          <WarningIcon />
          <div>
            <div className="escalated-title">Escalated to a maintainer</div>
            <div className="escalated-text">{d.question}</div>
            <div className="decision-options" role="group" aria-label="Maintainer decision">
              {d.options.map((o, i) => (
                <button
                  key={o.id}
                  type="button"
                  className={i === 0 ? "decision-btn is-first" : "decision-btn"}
                  disabled={resolve.isPending}
                  onClick={() =>
                    resolve.mutate(
                      { decisionId: d.id, optionId: o.id },
                      { onSuccess: () => flash(`Decided: ${o.label}`), onError: () => flash("Could not save that decision. Try again.") },
                    )
                  }
                >
                  {o.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
