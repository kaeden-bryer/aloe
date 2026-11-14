import { useCallback, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import type { Dashboard as DashboardData, ProjectSummary } from "@aloe/core/contracts";
import { useCauses, useDashboard, useMe, useProjects } from "../api/hooks";
import { LiveStatus } from "../components/dashboard/LiveStatus";
import { MergedChart } from "../components/dashboard/MergedChart";
import { ShareDialog } from "../components/dashboard/ShareDialog";
import { DecisionOptions } from "../components/DecisionOptions";
import { ShareIcon } from "../components/Icons";
import { StatusPill } from "../components/StatusPill";
import { ACTIVITY_VIEW, KIND_COLORS, projectColor } from "../lib/catalog";
import { isOnboarded } from "../lib/donor";
import { formatWhen } from "../lib/format";
import { buildSharePost } from "../lib/share";
import { cardDataFrom } from "../lib/shareCard";

export function Dashboard() {
  const navigate = useNavigate();
  const { data: dash, isPending, isError } = useDashboard();
  const { data: me } = useMe();
  const { data: projects = [] } = useProjects();
  const { data: causes = [] } = useCauses();
  const [shareOpen, setShareOpen] = useState(false);
  // Stable reference, so the dialog's Escape-key effect doesn't re-subscribe every render.
  const closeShare = useCallback(() => setShareOpen(false), []);

  const hasWork = !!dash && dash.landed.length > 0;
  const onboarded = isOnboarded(me);

  const share = useMemo(
    () => dash && buildSharePost(dash.landed, (id) => projects.find((p) => p.id === id)?.cause, causes),
    [dash, projects, causes],
  );
  // Data for the generated share image (memoised so the dialog doesn't re-render the PNG needlessly).
  const shareCard = useMemo(() => (dash ? cardDataFrom(dash) : undefined), [dash]);

  return (
    <div className="page" style={{ maxWidth: 1160, paddingTop: 48 }}>
      <div className="dash-head">
        <div style={{ flex: "1 1 420px", minWidth: 0 }}>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-lede">What your agent has been up to this week{dash ? ", " + dash.weekLabel : ""}.</p>
        </div>
        {hasWork && (
          <button type="button" className="btn-primary primary" style={{ padding: "10px 16px" }} onClick={() => setShareOpen(true)}>
            <ShareIcon />
            Share your week
          </button>
        )}
      </div>

      {isPending && <p className="loading" style={{ padding: "32px 0" }}>Loading your week…</p>}
      {isError && <p className="loading" style={{ padding: "32px 0" }}>Could not load the dashboard. Is the API running?</p>}

      {dash && !hasWork && (
        <div className="dash-empty">
          <div className="dash-empty-title">Your agent hasn't worked yet</div>
          <p>Back a project and your agent starts in your next donation window. This page fills in as its work gets verified.</p>
          <div style={{ marginTop: 20, display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" }}>
            <button type="button" className="btn-primary primary" style={{ padding: "10px 18px" }} onClick={() => navigate(onboarded ? "/market" : "/start")}>
              {onboarded ? "Browse the market" : "Set up Aloe"}
            </button>
          </div>
        </div>
      )}

      {dash && hasWork && (
        <div>
          <LiveStatus live={dash.live} paused={me?.settings.paused ?? false} />
          <Kpis kpis={dash.kpis} />
          <ChartPanel dash={dash} />
          <LandedTable landed={dash.landed} projects={projects} />
          <div className="dash-row">
            <ActivityFeed activity={dash.activity} />
            <div className="side-col">
              <WorkByKind kinds={dash.workByKind} />
              {dash.waiting.length > 0 && <Waiting decisions={dash.waiting} />}
            </div>
          </div>
          <AcrossAloe stats={dash.platform} />
        </div>
      )}

      {shareOpen && share && <ShareDialog post={share} card={shareCard} onClose={closeShare} />}
    </div>
  );
}

function Kpis({ kpis }: { kpis: DashboardData["kpis"] }) {
  return (
    <div className="kpis">
      {kpis.map((k) => (
        <div key={k.label} className="panel kpi">
          <div className="kpi-label">{k.label}</div>
          <div className="kpi-value">{k.value}</div>
          <div className="kpi-sub">{k.sub}</div>
        </div>
      ))}
    </div>
  );
}

function ChartPanel({ dash }: { dash: DashboardData }) {
  const names = new Map(dash.landed.map((l) => [l.projectId, l.name]));
  return (
    <div className="panel chart-panel">
      <div className="panel-head">
        <h2 className="panel-h2">Merged per day</h2>
        <div aria-label="Legend" className="legend">
          {dash.landed.map((l) => (
            <span key={l.projectId} className="legend-item">
              <span className="swatch" style={{ background: projectColor(l.projectId) }} />
              {l.name}
            </span>
          ))}
        </div>
      </div>
      <MergedChart days={dash.mergedPerDay} names={names} />
    </div>
  );
}

function LandedTable({ landed, projects }: { landed: DashboardData["landed"]; projects: ProjectSummary[] }) {
  const navigate = useNavigate();
  return (
    <div className="panel landed">
      <div className="landed-head">
        <h2 className="panel-h2">Where your work landed</h2>
        <span className="muted-13">Only verified, merged work counts</span>
      </div>
      <div className="table-scroll">
        <table>
          <thead>
            <tr>
              <th scope="col">Project</th>
              <th scope="col">Merged</th>
              <th scope="col">Your share of its merges</th>
              <th scope="col">In a release</th>
            </tr>
          </thead>
          <tbody>
            {landed.map((r) => {
              const pct = Math.round(r.share * 100);
              return (
                <tr key={r.projectId}>
                  <td>
                    <button type="button" className="landed-project ghost" onClick={() => navigate(`/projects/${r.projectId}`)}>
                      <span className="swatch" style={{ background: projectColor(r.projectId) }} />
                      <span className="e">{r.emoji}</span>
                      <span>
                        <span className="n">{r.name}</span>
                        {/* The API has no "reach" line, so we show the project's tagline. */}
                        <span className="s">{projects.find((p) => p.id === r.projectId)?.tagline}</span>
                      </span>
                    </button>
                  </td>
                  <td className="merged">{r.merged}</td>
                  <td>
                    <span className="share-cell">
                      <span aria-hidden="true" className="share-track">
                        <span style={{ width: pct + "%" }} />
                      </span>
                      <span className="v">{pct}%</span>
                    </span>
                  </td>
                  <td>{r.released ? "Shipped" : "Not yet"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ActivityFeed({ activity }: { activity: DashboardData["activity"] }) {
  return (
    <div className="panel feed">
      <h2 className="panel-h2">Activity</h2>
      <ol>
        {activity.map((a) => {
          const view = ACTIVITY_VIEW[a.status];
          return (
            <li key={`${a.ts}-${a.title}`}>
              <span className="when">{a.status === "working" ? "Now" : formatWhen(a.ts)}</span>
              <span className="main">
                <span className="t">{a.title}</span>
                <span className="p">
                  {a.projectEmoji} {a.projectName}
                </span>
              </span>
              <StatusPill tone={view.tone}>{view.label}</StatusPill>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

function WorkByKind({ kinds }: { kinds: DashboardData["workByKind"] }) {
  const total = kinds.reduce((a, k) => a + k.n, 0) || 1;
  const color = (i: number) => KIND_COLORS[i % KIND_COLORS.length]!;
  return (
    <div className="panel kinds">
      <h2 className="panel-h2">Work by kind</h2>
      <div className="kinds-bar">
        {kinds.map((k, i) => k.n > 0 && <span key={k.label} style={{ width: (k.n / total) * 100 + "%", background: color(i) }} />)}
      </div>
      <div className="kinds-list">
        {kinds.map((k, i) => (
          <div key={k.label}>
            <span className="swatch" style={{ background: color(i) }} />
            <span className="l">{k.label}</span>
            <span className="v">{k.n}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Waiting({ decisions }: { decisions: DashboardData["waiting"] }) {
  return (
    <div className="waiting">
      <h2>Waiting on a maintainer</h2>
      <p>Your agent keeps working on other tasks meanwhile.</p>
      <div className="waiting-list">
        {decisions.map((d) => (
          <div key={d.id} className="waiting-item">
            <div className="t">{decisionTitle(d.question)}</div>
            <div className="p">
              {d.projectEmoji} {d.projectName}
            </div>
            <DecisionOptions decision={d} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Questions may start with the quoted task title ("Title". Why…); the side panel shows just the title. */
function decisionTitle(question: string): string {
  const m = question.match(/^"([^"]+)"/);
  return m ? m[1]! : question;
}

function AcrossAloe({ stats }: { stats: DashboardData["platform"] }) {
  return (
    <div className="across">
      <div className="panel-head" style={{ gap: "6px 16px" }}>
        <h2 className="panel-h2">Across Aloe this week</h2>
        <span className="sub">Everyone's agents, all projects</span>
      </div>
      <div className="across-grid">
        {stats.map((s) => (
          <div key={s.label}>
            <div className="v">{s.value}</div>
            <div className="l">{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
