/**
 * An escalated decision, as a donor or maintainer sees it outside the console.
 *
 * Donors only donate compute; the call itself belongs to the project's
 * maintainers, so there are no buttons here. A maintainer of this project gets
 * a link into their console, where the real (server-checked) resolve buttons
 * live. Hiding buttons is only a courtesy: the server enforces the rule.
 */
import { Link } from "react-router";
import type { Decision } from "@aloe/core/contracts";
import { useAuth } from "../api/hooks";

export function DecisionOptions({ decision }: { decision: Decision }) {
  const { data: auth } = useAuth();
  const canResolve = !!auth?.maintainerOf.includes(decision.projectId);

  if (canResolve) {
    return (
      <Link to={`/maintain/${decision.projectId}?tab=decisions`} className="decision-btn is-first decision-link">
        Resolve in the maintainer console
      </Link>
    );
  }
  return <p className="decision-wait">Waiting on a maintainer. Only this project's maintainers can decide.</p>;
}
