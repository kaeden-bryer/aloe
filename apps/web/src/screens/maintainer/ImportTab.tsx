import { useState } from "react";
import { TaskCategory, TaskSpec, type DraftTask } from "@aloe/core/contracts";
import { ApiRequestError } from "../../api/client";
import { useDraftActions, useDrafts, useImport } from "../../api/maintainer";
import { useToast } from "../../components/Toast";

/**
 * Import open GitHub issues as drafts, then approve / edit / reject each one.
 * Drafts are invisible to donor agents until approved.
 */
export function ImportTab({ projectId }: { projectId: string }) {
  const flash = useToast();
  const { data: drafts, isPending } = useDrafts(projectId);
  const importer = useImport(projectId);
  const [label, setLabel] = useState("");

  const run = () =>
    importer.mutate(
      { label: label.trim() || undefined },
      {
        onSuccess: (r) => flash(`${r.drafts.length} new draft${r.drafts.length === 1 ? "" : "s"} from ${r.source}` + (r.skipped ? ` (${r.skipped} already seen)` : "")),
        onError: (e) => flash(e instanceof ApiRequestError ? e.message : "Import failed. Try again."),
      },
    );

  return (
    <div>
      <div className="maintain-card maintain-import">
        <label>
          <span className="muted-13">Only issues with label (optional)</span>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="good first issue" maxLength={100} />
        </label>
        <button type="button" className="btn-primary primary" disabled={importer.isPending} onClick={run}>
          {importer.isPending ? "Importing…" : "Import open issues"}
        </button>
      </div>
      <p className="queue-note">Up to 30 open issues are read from GitHub (the upstream repo if this one is a fork) and rewritten by the steward into tasks. Nothing reaches a donor agent until you approve it.</p>

      <h2 className="h2-section">Waiting for approval</h2>
      {isPending && <p className="loading">Loading drafts…</p>}
      {drafts && drafts.length === 0 && <p className="maintain-empty">No drafts. Import issues to fill this list.</p>}
      {drafts?.map((d) => <DraftCard key={d.id} projectId={projectId} draft={d} />)}
    </div>
  );
}

function DraftCard({ projectId, draft }: { projectId: string; draft: DraftTask }) {
  const flash = useToast();
  const { update, approve, reject } = useDraftActions(projectId);
  const [editing, setEditing] = useState(false);
  const [goal, setGoal] = useState(draft.spec.goal);
  const [criteria, setCriteria] = useState(draft.spec.acceptanceCriteria.join("\n"));
  const [files, setFiles] = useState(draft.spec.filesInScope.join("\n"));
  const [category, setCategory] = useState(draft.spec.category);
  const [testCommand, setTestCommand] = useState(draft.spec.testCommand);
  const [error, setError] = useState("");
  const busy = update.isPending || approve.isPending || reject.isPending;
  const lines = (s: string) => s.split("\n").map((x) => x.trim()).filter(Boolean);

  const save = () => {
    // Same schema the server uses, so errors show here before a round trip.
    const parsed = TaskSpec.safeParse({ ...draft.spec, goal, acceptanceCriteria: lines(criteria), filesInScope: lines(files), category, testCommand });
    if (!parsed.success) return setError("Needs a goal and 1 to 12 acceptance criteria, each under 500 characters.");
    setError("");
    update.mutate({ draftId: draft.id, spec: parsed.data }, { onSuccess: () => { setEditing(false); flash("Draft updated"); }, onError: () => flash("Could not save the edit.") });
  };

  return (
    <div className="maintain-card draft-card">
      <div className="draft-head">
        {draft.sourceIssue !== null && <span className="prop-tag">Issue #{draft.sourceIssue}</span>}
        <span className="prop-tag">{draft.spec.category}</span>
      </div>
      {editing ? (
        <div className="draft-edit">
          <label><span className="muted-13">Goal</span><textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} /></label>
          <label><span className="muted-13">Acceptance criteria (one per line)</span><textarea rows={3} value={criteria} onChange={(e) => setCriteria(e.target.value)} /></label>
          <label><span className="muted-13">Files in scope (one per line)</span><textarea rows={2} value={files} onChange={(e) => setFiles(e.target.value)} /></label>
          <div className="draft-row">
            <label><span className="muted-13">Category</span>
              <select value={category} onChange={(e) => setCategory(e.target.value as typeof category)}>
                {TaskCategory.options.map((c) => <option key={c} value={c}>{c}</option>)}
              </select>
            </label>
            <label><span className="muted-13">Test command</span><input value={testCommand} onChange={(e) => setTestCommand(e.target.value)} /></label>
          </div>
          {error && <p className="draft-error">{error}</p>}
          <div className="draft-actions">
            <button type="button" className="btn-primary primary" disabled={busy} onClick={save}>Save changes</button>
            <button type="button" className="btn-text ghost" onClick={() => setEditing(false)}>Cancel</button>
          </div>
        </div>
      ) : (
        <>
          <div className="draft-goal">{draft.spec.goal}</div>
          <ul className="draft-criteria">{draft.spec.acceptanceCriteria.map((c) => <li key={c}>{c}</li>)}</ul>
          {draft.spec.testCommand && <p className="muted-13">Test command: <code>{draft.spec.testCommand}</code></p>}
          <div className="draft-actions">
            <button
              type="button"
              className="btn-primary primary"
              disabled={busy}
              onClick={() => approve.mutate(draft.id, { onSuccess: () => flash("Approved. It's now in the donor queue."), onError: () => flash("Could not approve. Try again.") })}
            >
              Approve
            </button>
            <button type="button" className="btn-outline ghost" disabled={busy} onClick={() => setEditing(true)}>Edit</button>
            <button type="button" className="btn-text ghost" disabled={busy} onClick={() => reject.mutate(draft.id, { onSuccess: () => flash("Draft discarded") })}>Reject</button>
          </div>
        </>
      )}
    </div>
  );
}
