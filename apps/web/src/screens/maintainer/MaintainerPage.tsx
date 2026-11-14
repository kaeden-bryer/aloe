/**
 * /maintain/:projectId: the maintainer's console. Three tabs, kept in the URL
 * hash-free query (?tab=) so a reload or a shared link lands on the same one.
 */
import { useNavigate, useParams, useSearchParams } from "react-router";
import { useProject } from "../../api/hooks";
import { useInbox } from "../../api/maintainer";
import { BriefTab } from "./BriefTab";
import { DecisionsTab } from "./DecisionsTab";
import { ImportTab } from "./ImportTab";

const TABS = [
  { id: "brief", label: "Brief" },
  { id: "import", label: "Import & approve" },
  { id: "decisions", label: "Decisions" },
] as const;
type TabId = (typeof TABS)[number]["id"];

export function MaintainerPage() {
  const { projectId = "" } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { data: p, isPending, isError } = useProject(projectId);
  const inbox = useInbox(projectId);
  const tab: TabId = TABS.find((t) => t.id === params.get("tab"))?.id ?? "brief";
  const open = inbox.data?.length ?? 0;

  return (
    <div>
      <nav aria-label="Breadcrumb" className="crumbs">
        <button type="button" className="ghost" onClick={() => navigate(`/projects/${projectId}`)}>{p?.name ?? "Project"}</button>
        <span aria-hidden="true">/</span>
        <span className="here">Maintainer tools</span>
      </nav>
      {isPending && <p className="loading">Loading project…</p>}
      {isError && <p className="loading">We couldn't find that project.</p>}
      {p && (
        <div className="maintain-page">
          <h1>{p.emoji} {p.name}</h1>
          <p className="page-lede">Teach the steward about your project, approve the work it drafts, and answer what it escalates.</p>
          <div className="maintain-tabs" role="tablist">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                className="maintain-tab"
                onClick={() => setParams({ tab: t.id }, { replace: true })}
              >
                {t.label}
                {t.id === "decisions" && open > 0 && <span className="maintain-badge">{open}</span>}
              </button>
            ))}
          </div>
          {tab === "brief" && <BriefTab projectId={projectId} />}
          {tab === "import" && <ImportTab projectId={projectId} />}
          {tab === "decisions" && <DecisionsTab projectId={projectId} />}
        </div>
      )}
    </div>
  );
}
