/**
 * Mock-mode version of the Maintainer API, same routes and shapes as
 * apps/server/src/maintainer.ts. Kept in memory (resets on reload), which is
 * enough to click through the screens. Decision routes are forwarded to the
 * donor-side mock by mock.ts so both views stay consistent.
 */
import { INTERVIEW_QUESTIONS, OnboardRequest, TaskSpec, UpdateDraftRequest, type DraftTask } from "@aloe/core/contracts";

type Reply = { status: number; json: unknown };

const spec = (n: number, goal: string, category: TaskSpec["category"]): TaskSpec => ({
  goal,
  acceptanceCriteria: [`Resolves issue #${n}`, "All existing tests still pass"],
  filesInScope: [],
  category,
  testCommand: "npm test",
  sourceIssue: n,
});
const SAMPLE: [number, string, TaskSpec["category"]][] = [
  [41, "Add a CSV export for the priority index table", "feature"],
  [38, "Fix broken link in the contributing guide", "docs"],
  [35, "Add unit tests for the layer date parser", "tests"],
];

const briefs: Record<string, string> = {};
let drafts: (DraftTask & { status: "pending" | "approved" | "rejected" })[] = [];
let nextId = 1;
let nextIssue = 0;

const bad = (error: string): Reply => ({ status: 400, json: { error, code: "bad_request" } });
const missing = (what: string): Reply => ({ status: 404, json: { error: `${what} not found`, code: "not_found" } });

export function maintainerRoute(method: string, path: string, body: unknown, projectExists: (id: string) => boolean): Reply | null {
  const m = path.match(/^\/api\/maintain\/projects\/([^/]+)\/(brief|onboard|import|drafts)(?:\/([^/]+)(?:\/(approve|reject))?)?$/);
  if (!m) return null;
  const [, pid, what, draftId, action] = m as unknown as [string, string, string, string?, string?];
  if (!projectExists(pid)) return missing("Project");
  const pending = () => drafts.filter((d) => d.projectId === pid && d.status === "pending");

  if (what === "brief" && method === "GET") return { status: 200, json: { projectId: pid, brief: briefs[pid] ?? "" } };
  if (what === "onboard" && method === "POST") {
    const req = OnboardRequest.safeParse(body);
    if (!req.success) return bad("Answer at least one of the " + INTERVIEW_QUESTIONS.length + " questions");
    briefs[pid] = ["Project brief (from the maintainer interview)", "", ...req.data.answers.filter((a) => a.trim()).map((a) => `- ${a.trim()}`)].join("\n");
    return { status: 200, json: { projectId: pid, brief: briefs[pid] } };
  }
  if (what === "import" && method === "POST") {
    // Pretend GitHub has three open issues; each import hands out the next unseen ones.
    const fresh = SAMPLE.slice(nextIssue, nextIssue + 3);
    nextIssue += fresh.length;
    const made = fresh.map(([n, goal, cat]) => ({ id: `drf_mock${nextId++}`, projectId: pid, sourceIssue: n, spec: spec(n, goal, cat), createdAt: Date.now(), status: "pending" as const }));
    drafts.push(...made);
    return { status: 200, json: { drafts: made, skipped: SAMPLE.length - fresh.length, source: "demo/open-source-repo" } };
  }
  if (what === "drafts" && !draftId && method === "GET") return { status: 200, json: pending() };
  if (what === "drafts" && draftId) {
    const d = drafts.find((x) => x.id === draftId && x.projectId === pid);
    if (!d) return missing("Draft");
    if (d.status !== "pending") return { status: 409, json: { error: `Draft was already ${d.status}`, code: "conflict" } };
    if (method === "PUT" && !action) {
      const req = UpdateDraftRequest.safeParse(body);
      if (!req.success) return bad(req.error.message);
      d.spec = req.data.spec;
      return { status: 200, json: d };
    }
    if (method === "POST" && action === "approve") {
      d.status = "approved";
      return { status: 200, json: { taskId: `task_mock_${d.id}` } };
    }
    if (method === "POST" && action === "reject") {
      d.status = "rejected";
      return { status: 200, json: { ok: true } };
    }
  }
  return missing("Route");
}
