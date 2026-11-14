/**
 * The weekly donor email as a React component. React Email's components turn
 * into table-based HTML with inline styles, which is what email clients need
 * (most ignore <style> blocks and flexbox).
 *
 * Its input is the same `Dashboard` object the dashboard screen shows, so the
 * email and the screen can never disagree about the numbers.
 */
import { Body, Column, Container, Head, Heading, Hr, Html, Link, Preview, Row, Section, Text } from "@react-email/components";
import type { Dashboard } from "@aloe/core";

export interface WeeklyEmailProps {
  donorName: string;
  report: Dashboard;
  /** Where "open your dashboard" points. */
  dashboardUrl: string;
}

// Colours copied from apps/web/src/styles/aloe.css (email can't use CSS variables).
const c = { green: "#2f7d4f", greenDark: "#1b4f31", mint: "#c7f2d4", ink: "#1f1e1b", text: "#37352f", subtle: "#6b6a66", line: "#e6e5e3", soft: "#fbfbfa", forest: "#0c1811", select: "#f1f8f3" };
const font = "Inter, -apple-system, 'Segoe UI', Helvetica, Arial, sans-serif";

/** Pulls the headline numbers both the HTML and the text version use. */
export function summarize(report: Dashboard) {
  const kpi = (label: string) => report.kpis.find((k) => k.label === label);
  const mergedTotal = report.landed.reduce((sum, p) => sum + p.merged, 0);
  return {
    mergedTotal,
    merged: kpi("Merged this week"),
    quota: kpi("Quota donated"),
    streak: kpi("Streak"),
    landed: report.landed.filter((p) => p.merged > 0),
    // A few highlights: work that actually shipped (activity is already newest first).
    highlights: report.activity.filter((a) => a.status === "merged").slice(0, 4),
  };
}

export function emailSubject(report: Dashboard): string {
  const { mergedTotal } = summarize(report);
  return mergedTotal > 0
    ? `Your agent merged ${mergedTotal} change${mergedTotal === 1 ? "" : "s"} this week`
    : `Your Aloe week: ${report.weekLabel}`;
}

export function WeeklyEmail({ donorName, report, dashboardUrl }: WeeklyEmailProps) {
  const s = summarize(report);
  const first = donorName.split(" ")[0] ?? donorName;
  return (
    <Html lang="en">
      <Head />
      <Preview>{s.mergedTotal > 0 ? `${s.mergedTotal} merged this week. ${report.weekLabel}` : `A quiet week. ${report.weekLabel}`}</Preview>
      <Body style={{ margin: 0, padding: "24px 0", background: c.soft, fontFamily: font, color: c.text }}>
        <Container style={{ width: "100%", maxWidth: 600, margin: "0 auto", background: "#ffffff", border: `1px solid ${c.line}`, borderRadius: 14 }}>
          {/* Header band in the landing page's forest green */}
          <Section style={{ background: c.forest, padding: "24px 32px", borderRadius: "14px 14px 0 0" }}>
            <Text style={{ margin: 0, fontSize: 18, fontWeight: 700, color: c.mint }}>🌿 Aloe</Text>
            <Text style={{ margin: "4px 0 0", fontSize: 13, color: "#a9c9b4" }}>{report.weekLabel}</Text>
          </Section>

          <Section style={{ padding: "28px 32px 8px" }}>
            <Heading as="h1" style={{ margin: 0, fontSize: 24, lineHeight: "30px", color: c.ink }}>
              {s.mergedTotal > 0 ? `Nice week, ${first}.` : `Hi ${first}, a quiet week.`}
            </Heading>
            <Text style={{ margin: "8px 0 0", fontSize: 15, lineHeight: "22px" }}>
              {s.mergedTotal > 0
                ? `Your agent's work landed ${s.mergedTotal} time${s.mergedTotal === 1 ? "" : "s"} in the projects you back.`
                : "Nothing from your agent was merged this week. It picks up work again when your donation window opens."}
            </Text>
          </Section>

          {/* Big numbers */}
          <Section style={{ padding: "12px 32px" }}>
            <Row>
              {[s.merged, s.quota, s.streak].map((k) =>
                k ? (
                  <Column key={k.label} style={{ width: "33%", verticalAlign: "top", padding: "14px 12px", background: c.select, borderRadius: 10 }}>
                    <Text style={{ margin: 0, fontSize: 26, fontWeight: 700, color: c.greenDark }}>{k.value}</Text>
                    <Text style={{ margin: "2px 0 0", fontSize: 12, color: c.subtle }}>{k.label}</Text>
                  </Column>
                ) : null,
              )}
            </Row>
          </Section>

          {s.landed.length > 0 && (
            <Section style={{ padding: "8px 32px" }}>
              <Heading as="h2" style={h2}>What landed, by project</Heading>
              {s.landed.map((p) => (
                <Row key={p.projectId} style={{ borderBottom: `1px solid ${c.line}` }}>
                  <Column style={{ padding: "10px 0", fontSize: 15 }}>
                    {p.emoji} <strong style={{ color: c.ink }}>{p.name}</strong>
                    {p.released ? <span style={{ color: c.green }}> · released</span> : null}
                  </Column>
                  <Column align="right" style={{ padding: "10px 0", fontSize: 14, color: c.subtle, whiteSpace: "nowrap" }}>
                    {p.merged} merged · {Math.round(p.share * 100)}% yours
                  </Column>
                </Row>
              ))}
            </Section>
          )}

          {s.highlights.length > 0 && (
            <Section style={{ padding: "8px 32px" }}>
              <Heading as="h2" style={h2}>Highlights</Heading>
              {s.highlights.map((a, i) => (
                <Text key={i} style={{ margin: "0 0 6px", fontSize: 14, lineHeight: "20px" }}>
                  ✅ {a.title} <span style={{ color: c.subtle }}>· {a.projectEmoji} {a.projectName}</span>
                </Text>
              ))}
            </Section>
          )}

          {report.waiting.length > 0 && (
            <Section style={{ padding: "8px 32px" }}>
              <Heading as="h2" style={h2}>Waiting for a decision</Heading>
              {report.waiting.map((d) => (
                <Text key={d.id} style={{ margin: "0 0 8px", padding: "10px 12px", fontSize: 14, lineHeight: "20px", background: "#fff8e6", borderRadius: 8 }}>
                  {d.projectEmoji} <strong>{d.projectName}:</strong> {d.question}
                </Text>
              ))}
              <Link href={dashboardUrl} style={{ fontSize: 14, color: c.green }}>Review on your dashboard</Link>
            </Section>
          )}

          <Section style={{ padding: "16px 32px 8px" }}>
            <Heading as="h2" style={h2}>Aloe as a whole</Heading>
            {report.platform.map((p) => (
              <Row key={p.label}>
                <Column style={{ padding: "3px 0", fontSize: 14, color: c.subtle }}>{p.label}</Column>
                <Column align="right" style={{ padding: "3px 0", fontSize: 14, fontWeight: 600, color: c.ink }}>{p.value}</Column>
              </Row>
            ))}
          </Section>

          <Section style={{ padding: "20px 32px 28px", textAlign: "center" }}>
            <Link href={dashboardUrl} style={{ display: "inline-block", padding: "12px 24px", background: c.green, color: "#ffffff", borderRadius: 10, fontWeight: 600, fontSize: 15, textDecoration: "none" }}>
              Open your dashboard
            </Link>
          </Section>
          <Hr style={{ borderColor: c.line, margin: 0 }} />
          <Section style={{ padding: "16px 32px" }}>
            <Text style={{ margin: 0, fontSize: 12, color: c.subtle, lineHeight: "18px" }}>
              You get this because the weekly report is on in Settings. You can turn it off there any time.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const h2 = { margin: "0 0 8px", fontSize: 13, fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" as const, color: c.subtle };
