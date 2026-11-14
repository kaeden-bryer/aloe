/**
 * Onboarding: causes -> donation share + window -> projects to back.
 * The step lives in the URL (?step=2) so the browser's back button works.
 * Choices stay local until "Start donating" sends them to the API in one go.
 */
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import type { CauseId, Schedule } from "@aloe/core/contracts";
import { useCauses, useMe, useProjects, useStartDonating } from "../api/hooks";
import { Brand } from "../components/Brand";
import { ArrowRight, CheckIcon } from "../components/Icons";
import { ScheduleOptions } from "../components/ScheduleOptions";
import { useToast } from "../components/Toast";
import { scheduleLabel } from "../lib/catalog";
import { pctHint } from "../lib/format";

const toggleIn = <T,>(arr: T[], x: T) => (arr.includes(x) ? arr.filter((y) => y !== x) : [...arr, x]);

export function Onboarding() {
  const navigate = useNavigate();
  const flash = useToast();
  const [params, setParams] = useSearchParams();
  const { data: causes = [] } = useCauses();
  const { data: projects = [] } = useProjects();
  const { data: me } = useMe();
  const start = useStartDonating();

  const [goals, setGoals] = useState<CauseId[]>([]);
  const [pct, setPct] = useState(50);
  const [schedule, setSchedule] = useState<Schedule>("overnight");
  // null means "untouched": default to every project that matches the causes.
  const [pickedState, setPicked] = useState<string[] | null>(null);

  // Returning donors start from their saved settings (only once, when "me" arrives).
  const prefilled = useRef(false);
  useEffect(() => {
    if (!me || prefilled.current) return;
    prefilled.current = true;
    if (me.settings.causes.length) {
      setGoals(me.settings.causes);
      setPct(me.settings.pct);
      setSchedule(me.settings.schedule);
    }
  }, [me]);

  // Later steps need at least one cause; deep links without one fall back to step 1.
  const requested = Number(params.get("step")) || 1;
  const step = goals.length === 0 ? 1 : Math.min(3, Math.max(1, requested));
  const goTo = (n: number) => setParams(n === 1 ? {} : { step: String(n) });

  const matches = (p: (typeof projects)[number]) => goals.includes(p.cause) || p.alsoCauses.some((c) => goals.includes(c));
  const matching = projects.filter(matches);

  const picked = pickedState ?? matching.map((p) => p.id);

  const toStep3 = () => {
    setPicked(null); // re-match, in case the causes changed since last time
    goTo(3);
  };

  const startDonating = () => {
    if (!me) return;
    start.mutate(
      {
        settings: { ...me.settings, causes: goals, pct, schedule, paused: false },
        picked,
        previous: me.backings,
      },
      {
        onSuccess: () => {
          navigate("/market");
          flash("You are set. Your agent starts in your next donation window.");
        },
        onError: () => flash("Something went wrong saving your choices. Try again."),
      },
    );
  };

  const goalSummary = goals
    .map((id) => causes.find((c) => c.id === id))
    .filter((c) => c !== undefined)
    .map((c) => c.emoji + " " + c.name)
    .join(", ");

  return (
    <div className="onboard">
      <header className="onboard-col onboard-header">
        <Brand logoSize={26} />
        <span className="onboard-step">Step {step} of 3</span>
      </header>
      <div className="onboard-col">
        <div className="progress" role="progressbar" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step} aria-label="Onboarding progress">
          <div style={{ width: Math.round((step / 3) * 100) + "%" }} />
        </div>
      </div>

      <main className="onboard-col onboard-main">
        {step === 1 && (
          <div>
            <h1 className="onboard-h1">What do you want to help heal?</h1>
            <p className="onboard-lede">Pick as many as you like. Aloe matches your agent to vetted projects in these causes.</p>
            <div className="tile-grid">
              {causes.map((c) => (
                <button key={c.id} type="button" className="tile cause-tile" aria-pressed={goals.includes(c.id)} onClick={() => setGoals((g) => toggleIn(g, c.id))}>
                  <span className="cause-tile-top">
                    <span className="cause-tile-emoji">{c.emoji}</span>
                    <span className="check">
                      <CheckIcon />
                    </span>
                  </span>
                  <span className="cause-tile-name">{c.name}</span>
                  <span className="cause-tile-blurb">{c.blurb}</span>
                </button>
              ))}
            </div>
            <div className="onboard-nav">
              <button type="button" className="btn-text ghost" onClick={() => navigate("/")}>Back</button>
              <button type="button" className="btn-primary primary" disabled={goals.length === 0} onClick={() => goTo(2)}>Continue</button>
            </div>
          </div>
        )}

        {step === 2 && (
          <div>
            <h1 className="onboard-h1">How much of your unused quota should Aloe use?</h1>
            <p className="onboard-lede">Aloe only uses quota that would otherwise expire at your weekly reset. Your own work always comes first.</p>
            <div className="quota-card">
              <div className="quota-head">
                <label htmlFor="pct-onboard">Share of unused weekly quota</label>
                <span className="quota-value">{pct}%</span>
              </div>
              <input id="pct-onboard" type="range" min={0} max={100} step={5} value={pct} onChange={(e) => setPct(Number(e.target.value))} style={{ width: "100%", margin: "18px 0 4px" }} />
              <div className="range-scale"><span>0%</span><span>50%</span><span>100%</span></div>
              <p className="quota-hint">{pctHint(pct)}</p>
            </div>
            <h2 className="onboard-h2">When can your agent run?</h2>
            <ScheduleOptions value={schedule} onChange={setSchedule} />
            <div className="onboard-nav">
              <button type="button" className="btn-text ghost" onClick={() => goTo(1)}>Back</button>
              <button type="button" className="btn-primary primary" onClick={toStep3}>Continue</button>
            </div>
          </div>
        )}

        {step === 3 && (
          <div>
            <h1 className="onboard-h1">Projects your agent will back</h1>
            <p className="onboard-lede">These vetted projects match your causes. Your donated quota is split equally between the ones you keep, and you can change this any time.</p>
            <div className="pick-list">
              {matching.map((p) => (
                <button key={p.id} type="button" className="tile pick-row" aria-pressed={picked.includes(p.id)} onClick={() => setPicked(toggleIn(picked, p.id))}>
                  <span className="check is-square">
                    <CheckIcon />
                  </span>
                  <span className="pick-emoji">{p.emoji}</span>
                  <span className="pick-main">
                    <span className="n">{p.name}</span>
                    <span className="t">{p.tagline}</span>
                  </span>
                  <span className="pick-owner">{p.owner}</span>
                </button>
              ))}
            </div>
            <div className="summary-bar">
              <span><span className="k">Causes</span>&nbsp; <span className="v">{goalSummary}</span></span>
              <span><span className="k">Donating</span>&nbsp; <span className="v">{pct}% of unused quota</span></span>
              <span><span className="k">Window</span>&nbsp; <span className="v">{scheduleLabel(schedule)}</span></span>
            </div>
            <div className="onboard-nav">
              <button type="button" className="btn-text ghost" onClick={() => goTo(2)}>Back</button>
              <button type="button" className="btn-primary primary" disabled={picked.length === 0 || !me || start.isPending} onClick={startDonating}>
                Start donating
                <ArrowRight size={17} strokeWidth={2} />
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
