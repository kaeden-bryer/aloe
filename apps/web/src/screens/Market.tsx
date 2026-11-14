import { useState } from "react";
import { useNavigate } from "react-router";
import type { CauseId, ProjectSummary } from "@aloe/core/contracts";
import { useCauses, useMe, useProjects } from "../api/hooks";
import { InfoIcon } from "../components/Icons";
import { CAUSE_COVER } from "../lib/catalog";

type Filter = "all" | "mine" | CauseId;

const inCauses = (p: ProjectSummary, ids: CauseId[]) => ids.includes(p.cause) || p.alsoCauses.some((c) => ids.includes(c));

export function Market() {
  const navigate = useNavigate();
  const { data: projects = [], isPending } = useProjects();
  const { data: causes = [] } = useCauses();
  const { data: me } = useMe();
  const myCauses = me?.settings.causes ?? [];

  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");

  const filters: { id: Filter; label: string }[] = [
    { id: "all", label: "All projects" },
    ...(myCauses.length ? [{ id: "mine" as const, label: "Your causes" }] : []),
    ...causes.map((c) => ({ id: c.id, label: c.emoji + " " + c.name })),
  ];

  // Filtering is client-side: five projects don't need a server round trip per keystroke.
  const q = query.trim().toLowerCase();
  const shown = projects.filter((p) => {
    if (filter === "mine" && !inCauses(p, myCauses)) return false;
    if (filter !== "all" && filter !== "mine" && !inCauses(p, [filter])) return false;
    if (q && !(p.name + " " + p.owner + " " + p.tagline).toLowerCase().includes(q)) return false;
    return true;
  });

  return (
    <div className="page" style={{ maxWidth: 1100 }}>
      <h1 className="page-title">Market</h1>
      <p className="page-lede" style={{ maxWidth: 660 }}>
        Vetted open-source projects from the Digital Public Goods registry. Back a project and your agent works through its task queue whenever you have quota to spare.
      </p>

      <div className="market-tools">
        <div role="group" aria-label="Filter by cause" className="filter-chips">
          {filters.map((f) => (
            <button key={f.id} type="button" className="filter-chip" aria-pressed={filter === f.id} onClick={() => setFilter(f.id)}>
              {f.label}
            </button>
          ))}
        </div>
        <input type="search" className="search" aria-label="Search projects" placeholder="Search projects" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>

      <div className="market-grid">
        {shown.map((p) => (
          <button key={p.id} type="button" className="project-card card" onClick={() => navigate(`/projects/${p.id}`)}>
            <span className="project-cover" style={{ background: CAUSE_COVER[p.cause] }}>
              <span>{p.emoji}</span>
            </span>
            <span className="project-body">
              <span className="project-tags">
                <span className="tag">{causes.find((c) => c.id === p.cause)?.name}</span>
                {p.backing && <span className="tag-green">Backing</span>}
              </span>
              <span className="project-name">{p.name}</span>
              <span className="project-owner">{p.owner}</span>
              <span className="project-tagline">{p.tagline}</span>
              <span className="project-foot">
                <span>{p.openTasks} tasks in the queue</span>
                <span>{p.type}</span>
              </span>
            </span>
          </button>
        ))}
      </div>

      {!isPending && shown.length === 0 && <div className="market-empty">No projects match that filter yet.</div>}

      <p className="market-note">
        <InfoIcon />
        Aloe curates every listing for now. Companies can't create project listings.
      </p>
    </div>
  );
}
