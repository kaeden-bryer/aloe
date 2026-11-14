/**
 * Settings save as you go: every change is a PUT /api/me/settings. Toggles
 * save immediately (with an optimistic update, see useSaveSettings); the
 * slider is debounced so dragging it doesn't fire a request per step.
 */
import { useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router";
import type { CauseId, DonorSettings, Me } from "@aloe/core/contracts";
import { useAuth, useCauses, useMe, useResetDemo, useSaveSettings } from "../api/hooks";
import { ScheduleOptions } from "../components/ScheduleOptions";
import { Switch } from "../components/Switch";
import { useToast } from "../components/Toast";
import { useDebouncedCallback } from "../hooks/useDebouncedCallback";
import { pctHint } from "../lib/format";

export function Settings() {
  const { data: me, isPending } = useMe();
  if (isPending || !me) return <p className="loading">Loading settings…</p>;
  return <SettingsForm me={me} />;
}

function SettingsForm({ me }: { me: Me }) {
  const navigate = useNavigate();
  const flash = useToast();
  const { data: causes = [] } = useCauses();
  const saveSettings = useSaveSettings();
  const reset = useResetDemo();
  const { data: auth } = useAuth();
  const canResetGithub = auth?.maintainerOf.includes("ccf") ?? false;
  const s = me.settings;

  // Always build the next settings from the latest server copy, so a delayed
  // slider save can't undo a toggle you flipped in the meantime.
  const latest = useRef(s);
  useEffect(() => {
    latest.current = s;
  }, [s]);

  const save = (patch: Partial<DonorSettings>, message?: string) => {
    saveSettings.mutate(
      { ...latest.current, ...patch },
      {
        onSuccess: () => message && flash(message),
        onError: () => flash("That didn't save. Try again."),
      },
    );
  };

  // While dragging, show the local value; null means "show what the server has".
  const [pctDraft, setPctDraft] = useState<number | null>(null);
  const pct = pctDraft ?? s.pct;
  const savePct = useDebouncedCallback((value: number) => {
    saveSettings.mutate({ ...latest.current, pct: value }, { onSettled: () => setPctDraft(null) });
  }, 400);

  const toggleCause = (id: CauseId) => {
    const next = s.causes.includes(id) ? s.causes.filter((c) => c !== id) : [...s.causes, id];
    save({ causes: next }, "Causes saved");
  };

  const resetDemo = () =>
    reset.mutate(undefined, {
      onSuccess: () => navigate("/"),
      onError: () => flash("Could not reset the demo."),
    });

  // Also resets the demo fork on GitHub. Stays on this page so the result below is readable.
  const resetAll = () => reset.mutate(true, { onError: () => flash("Could not reset the demo.") });
  const gh = reset.variables === true ? reset.data?.github : undefined;

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <h1 className="page-title">Settings</h1>
      <p className="page-lede">Change what your agent works on and how much it donates. Changes save as you go.</p>

      <h2 className="settings-h2">Causes</h2>
      <p className="settings-note">The market highlights projects in these causes.</p>
      <div className="cause-chips">
        {causes.map((c) => (
          <button key={c.id} type="button" className="cause-chip" aria-pressed={s.causes.includes(c.id)} onClick={() => toggleCause(c.id)}>
            <span className="e">{c.emoji}</span>
            {c.name}
          </button>
        ))}
      </div>

      <h2 className="settings-h2">Donation</h2>
      <div className="settings-pct">
        <label htmlFor="pct-settings">Share of unused weekly quota</label>
        <span className="v">{pct}%</span>
      </div>
      <input
        id="pct-settings"
        type="range"
        min={0}
        max={100}
        step={5}
        value={pct}
        onChange={(e) => {
          const v = Number(e.target.value);
          setPctDraft(v);
          savePct(v);
        }}
        style={{ width: "100%", margin: "12px 0 4px" }}
      />
      <p className="settings-note" style={{ marginTop: 6 }}>{pctHint(pct)}</p>
      <p style={{ margin: "20px 0 8px", fontWeight: 500, color: "#1F1E1B" }}>Donation window</p>
      <ScheduleOptions compact value={s.schedule} onChange={(schedule) => save({ schedule }, "Donation window saved")} />
      <div className="setting-row is-top">
        <div>
          <div className="t">Pause donations</div>
          <div className="d">Your agent stops picking up new tasks until you resume.</div>
        </div>
        <Switch on={s.paused} label="Pause donations" onToggle={() => save({ paused: !s.paused }, !s.paused ? "Donations paused" : "Donations resumed")} />
      </div>

      <h2 className="settings-h2 is-tight">Notifications</h2>
      <div className="setting-row">
        <div>
          <div className="t">Weekly report email</div>
          <div className="d">What your agent shipped, plus what Aloe did as a whole. Only sent in weeks your agent worked. <Link to="/settings/weekly-email">Preview this week's email</Link></div>
        </div>
        <Switch on={s.weeklyEmail} label="Weekly report email" onToggle={() => save({ weeklyEmail: !s.weeklyEmail }, "Notification settings saved")} />
      </div>
      <div className="setting-row">
        <div>
          <div className="t">Maintainer decisions</div>
          <div className="d">Tell me when a maintainer decides something on a project I back.</div>
        </div>
        <Switch on={s.decisionAlerts} label="Maintainer decisions" onToggle={() => save({ decisionAlerts: !s.decisionAlerts }, "Notification settings saved")} />
      </div>

      <h2 className="settings-h2 is-tight">Account</h2>
      <div className="account-row">
        <span className="k">Name</span>
        <span className="v">{me.name}</span>
      </div>
      <div className="account-row">
        <span className="k">Connected subscription</span>
        <span className="v">Claude Pro</span>
        <span className="tag-green" style={{ padding: "1px 8px", fontWeight: 500 }}>
          {me.devices.length > 0 ? "Connected" : "Not paired"}
        </span>
      </div>
      <div className="reset-box">
        <div>
          <div style={{ fontWeight: 500, color: "#1F1E1B" }}>Reset demo</div>
          <div style={{ fontSize: 14, color: "#6B6A66" }}>Clear every choice and go back to the landing page.</div>
        </div>
        <button type="button" className="btn-outline ghost" disabled={reset.isPending} onClick={resetDemo}>
          Reset
        </button>
      </div>
      {/* The server enforces this too (403 unless you maintain the demo project). */}
      {canResetGithub && (
      <div className="reset-box">
        <div>
          <div style={{ fontWeight: 500, color: "#1F1E1B" }}>Reset demo + GitHub</div>
          <div style={{ fontSize: 14, color: "#6B6A66" }}>
            Also closes the open pull request and puts the demo fork's aloe/ branches back to the pinned commit.
          </div>
          {gh && (
            <div role="status" style={{ marginTop: 8, fontSize: 14, color: gh.ok ? "#2F7D4F" : "#B3261E" }}>
              {gh.message}
            </div>
          )}
        </div>
        <button type="button" className="btn-outline ghost" disabled={reset.isPending} onClick={resetAll}>
          {reset.isPending && reset.variables === true ? "Resetting…" : "Reset + GitHub"}
        </button>
      </div>
      )}
    </div>
  );
}
