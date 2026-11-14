import { createElement } from "react";
import { render } from "@react-email/render";
import type { Dashboard } from "@aloe/core";
import { WeeklyEmail, emailSubject, summarize } from "./WeeklyEmail.tsx";

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
}

interface Input {
  donorName: string;
  report: Dashboard;
  dashboardUrl: string;
}

export async function renderWeeklyEmail(input: Input): Promise<RenderedEmail> {
  // Same data, two outputs: HTML for most clients, hand-written plain text for the rest
  // (so the text reads like a letter, not stripped HTML).
  const html = await render(createElement(WeeklyEmail, input));
  return { subject: emailSubject(input.report), html, text: weeklyEmailText(input) };
}

export function weeklyEmailText({ donorName, report, dashboardUrl }: Input): string {
  const s = summarize(report);
  const lines = [`Aloe weekly report, ${report.weekLabel}`, "", `Hi ${donorName.split(" ")[0] ?? donorName},`, ""];
  lines.push(
    s.mergedTotal > 0
      ? `Your agent's work landed ${s.mergedTotal} time${s.mergedTotal === 1 ? "" : "s"} this week.`
      : "Nothing from your agent was merged this week.",
  );
  for (const k of [s.merged, s.quota, s.streak]) if (k) lines.push(`- ${k.label}: ${k.value} (${k.sub})`);
  if (s.landed.length) {
    lines.push("", "WHAT LANDED");
    for (const p of s.landed) lines.push(`- ${p.emoji} ${p.name}: ${p.merged} merged, ${Math.round(p.share * 100)}% yours${p.released ? " (released)" : ""}`);
  }
  if (s.highlights.length) {
    lines.push("", "HIGHLIGHTS");
    for (const a of s.highlights) lines.push(`- ${a.title} (${a.projectName})`);
  }
  if (report.waiting.length) {
    lines.push("", "WAITING FOR A DECISION");
    for (const d of report.waiting) lines.push(`- ${d.projectName}: ${d.question}`);
  }
  lines.push("", "ALOE AS A WHOLE");
  for (const p of report.platform) lines.push(`- ${p.label}: ${p.value}`);
  lines.push("", `Open your dashboard: ${dashboardUrl}`);
  return lines.join("\n");
}
