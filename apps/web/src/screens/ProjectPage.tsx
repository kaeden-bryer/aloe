import type { ReactNode } from "react";
import { useNavigate, useParams } from "react-router";
import type { ProjectDetail } from "@aloe/core/contracts";
import { useCauses, useMe, useProject, useToggleBacking } from "../api/hooks";
import { DecisionOptions } from "../components/DecisionOptions";
import { CheckIcon, PlusIcon, WarningIcon } from "../components/Icons";
import { StatusPill } from "../components/StatusPill";
import { useToast } from "../components/Toast";
import { CAUSE_COVER, REGISTRY_URL, TASK_STATE_VIEW } from "../lib/catalog";
import { urlLabel } from "../lib/format";

export function ProjectPage() {
  const { id = "" } = useParams();
  const navigate = useNavigate();
  const { data: p, isPending, isError } = useProject(id);

  return (
    <div>
      <nav aria-label="Breadcrumb" className="crumbs">
        <button type="button" className="ghost" onClick={() => navigate("/market")}>Market</button>
        <span aria-hidden="true">/</span>
        <span className="here">{p?.name}</span>
      </nav>
      {isPending && <p className="loading">Loading project…</p>}
      {isError && <p className="loading">We couldn't find that project.</p>}
      {p && <ProjectBody p={p} />}
    </div>
  );
}

function ProjectBody({ p }: { p: ProjectDetail }) {
  const flash = useToast();
  const { data: causes = [] } = useCauses();
  const { data: me } = useMe();
  const toggle = useToggleBacking();

  const toggleBack = () => {
    const back = !p.backing;
    toggle.mutate(
      { id: p.id, back },
      {
        onSuccess: () => flash(back ? "Your agent will work on " + p.name + " in your next donation window" : "Stopped backing " + p.name),
        onError: () => flash("That didn't save. Try again."),
      },
    );
  };

  const causeTags = [p.cause, ...p.alsoCauses].map((id) => causes.find((c) => c.id === id)).filter((c) => c !== undefined);
  const count = (...states: ProjectDetail["queue"][number]["state"][]) => p.queue.filter((t) => states.includes(t.state)).length;
  const summary = `${count("merged")} merged · ${count("submitted", "verifying")} in review · ${count("leased")} in progress · ${count("queued")} open`;

  const n = me?.backings.length ?? 0;
  const share = n ? Math.round(100 / n) : 0;
  const shareText = me?.settings.paused
    ? "Donations are paused. Your agent resumes on this project when you turn them back on."
    : "of your donated quota goes here, split equally across the " + n + (n === 1 ? " project" : " projects") + " you back.";

  return (
    <>
      <div className="project-hero-cover" style={{ background: CAUSE_COVER[p.cause] }} />
      <div className="project-page">
        <div className="project-emoji">{p.emoji}</div>
        <div className="project-head">
          <div className="project-head-main">
            <h1>{p.name}</h1>
            <p>{p.tagline}</p>
          </div>
          {p.backing ? (
            <div className="backed-actions">
              <span className="backed-badge">
                <CheckIcon size={16} strokeWidth={2.5} />
                Your agent is on this
              </span>
              <button type="button" className="btn-text ghost" style={{ padding: "11px 14px", fontWeight: 500, fontSize: 14 }} disabled={toggle.isPending} onClick={toggleBack}>
                Stop backing
              </button>
            </div>
          ) : (
            <button type="button" className="btn-primary primary" style={{ padding: "12px 20px" }} disabled={toggle.isPending} onClick={toggleBack}>
              <PlusIcon />
              Direct my agent here
            </button>
          )}
        </div>

        <div className="project-cols">
          <div className="project-main">
            <div className="props">
              <Prop k="Causes">
                {causeTags.map((c) => (
                  <span key={c.id} className="prop-tag">{c.emoji} {c.name}</span>
                ))}
              </Prop>
              <Prop k="Maintained by">{p.owner}</Prop>
              <Prop k="Vetting">
                <span className="prop-tag is-green">Verified digital public good</span>
                <a href={REGISTRY_URL} target="_blank" rel="noopener" style={{ fontSize: 13, marginLeft: 4 }}>View on registry</a>
              </Prop>
              <Prop k="Type">{p.type}</Prop>
              <Prop k="Focus">{p.region}</Prop>
              <Prop k="Website">
                <a href={p.url} target="_blank" rel="noopener">{urlLabel(p.url)}</a>
              </Prop>
            </div>

            <h2 className="h2-section">About</h2>
            <p className="about">{p.about}</p>

            <div className="queue-head">
              <h2 className="h2-section">Task queue</h2>
              <span className="muted-13">{summary}</span>
            </div>
            <p className="queue-note">The project's AI steward builds this queue from open issues and leases each task to one donor agent at a time.</p>
            <div className="queue">
              {p.queue.map((t) => {
                const view = TASK_STATE_VIEW[t.state];
                return (
                  <div key={t.id} className="queue-row">
                    <span className="t">{t.title}</span>
                    <span className="w">{t.who}</span>
                    <StatusPill tone={view.tone}>{view.label}</StatusPill>
                  </div>
                );
              })}
            </div>

            {p.openDecision && (
              <div className="escalated">
                <WarningIcon />
                <div>
                  <div className="escalated-title">Escalated to a maintainer</div>
                  <div className="escalated-text">{p.openDecision.question}</div>
                  <DecisionOptions decision={p.openDecision} />
                </div>
              </div>
            )}
          </div>

          <div className="project-side">
            <div className="side-card">
              {p.backing ? (
                <div>
                  <span className="tag-green">Backing</span>
                  <p className="side-share">{share}%</p>
                  <p style={{ marginTop: 8 }}>{shareText}</p>
                </div>
              ) : (
                <div>
                  <h3>Back this project</h3>
                  <p>Your agent picks up tasks from this queue during your donation window. The steward hands out leases, so donor agents never duplicate each other.</p>
                  <button type="button" className="btn-primary primary" style={{ marginTop: 14, width: "100%", padding: "11px 16px" }} disabled={toggle.isPending} onClick={toggleBack}>
                    Direct my agent here
                  </button>
                </div>
              )}
            </div>

            <div className="steward-card">
              <h3>How the steward decides</h3>
              <div className="steward-list">
                <div><i style={{ background: "#2F7D4F" }} /><span><b>Merges on its own:</b> tests, docs, lint fixes</span></div>
                <div><i style={{ background: "#C99A2E" }} /><span><b>Spot-checked:</b> feature work inside one module</span></div>
                <div><i style={{ background: "#C2662D" }} /><span><b>Always a maintainer:</b> interfaces, security, personal data, releases</span></div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

function Prop({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="prop">
      <span className="prop-k">{k}</span>
      <span className="prop-v">{children}</span>
    </div>
  );
}
