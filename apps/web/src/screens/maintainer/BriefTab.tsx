import { useState } from "react";
import { INTERVIEW_QUESTIONS } from "@aloe/core/contracts";
import { useBrief, useOnboard } from "../../api/maintainer";
import { useToast } from "../../components/Toast";

/** The five-question interview. Answers go to the steward, which writes the brief agents read. */
export function BriefTab({ projectId }: { projectId: string }) {
  const flash = useToast();
  const { data, isPending } = useBrief(projectId);
  const onboard = useOnboard(projectId);
  const [answers, setAnswers] = useState<string[]>(() => INTERVIEW_QUESTIONS.map(() => ""));
  const filled = answers.some((a) => a.trim() !== "");

  return (
    <div className="maintain-cols">
      <form
        className="maintain-card"
        onSubmit={(e) => {
          e.preventDefault();
          onboard.mutate(answers, {
            onSuccess: () => flash("Brief saved. Agents will read it before every task."),
            onError: () => flash("Could not save the brief. Try again."),
          });
        }}
      >
        <h2 className="h2-section" style={{ marginTop: 0 }}>Interview</h2>
        {INTERVIEW_QUESTIONS.map((q, i) => (
          <label key={q} className="maintain-q">
            <span>{i + 1}. {q}</span>
            <textarea
              rows={3}
              maxLength={4000}
              value={answers[i]}
              onChange={(e) => setAnswers(answers.map((a, j) => (j === i ? e.target.value : a)))}
            />
          </label>
        ))}
        <button type="submit" className="btn-primary primary" disabled={!filled || onboard.isPending}>
          {onboard.isPending ? "Writing brief…" : data?.brief ? "Rewrite brief" : "Write brief"}
        </button>
      </form>

      <div className="maintain-card">
        <h2 className="h2-section" style={{ marginTop: 0 }}>Current brief</h2>
        {isPending ? <p className="muted-13">Loading…</p> : data?.brief ? <pre className="maintain-brief">{data.brief}</pre> : <p className="muted-13">No brief yet. Answer the interview and the steward will write one.</p>}
      </div>
    </div>
  );
}
