/**
 * Shows the weekly donor email exactly as the server renders it, inside an
 * iframe (so the email's own styles can't leak into the app, or the reverse).
 * "Send to me" asks the server to email it; without a RESEND_API_KEY the
 * server answers 503 not_configured and we show that as a friendly note.
 */
import { useState } from "react";
import { Link } from "react-router";
import { useMutation } from "@tanstack/react-query";
import { api, ApiRequestError, USE_MOCKS } from "../api/client";
import { useMe } from "../api/hooks";

export function WeeklyEmailPreview() {
  const { data: me } = useMe();
  const [note, setNote] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: api.sendWeeklyEmail,
    onSuccess: (r) => setNote(`Sent to ${r.to}.`),
    onError: (e) =>
      setNote(e instanceof ApiRequestError && e.code === "not_configured" ? e.message : "That didn't send. Try again."),
  });

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <p className="settings-note"><Link to="/settings">← Settings</Link></p>
      <h1 className="page-title">Weekly email preview</h1>
      <p className="page-lede">
        This is what {me?.email ?? "you"} would get: built from the same numbers as your dashboard.
      </p>
      <div className="email-actions">
        <button type="button" className="btn-primary primary" disabled={send.isPending || USE_MOCKS} onClick={() => send.mutate()}>
          {send.isPending ? "Sending…" : "Send to me"}
        </button>
        {note && <span role="status" className="settings-note">{note}</span>}
      </div>
      {USE_MOCKS ? (
        // Mock mode has no server to render the email, so say so instead of showing a broken frame.
        <p className="settings-note">The email is rendered by the server. Run <code>pnpm dev</code> (not <code>dev:mock</code>) to preview it here.</p>
      ) : (
        <iframe className="email-frame" title="Weekly email preview" src="/api/me/weekly-email" />
      )}
    </div>
  );
}
