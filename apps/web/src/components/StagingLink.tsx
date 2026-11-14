import { useStaging } from "../api/staging";

/**
 * "View PR on GitHub" for the project's one staging pull request.
 * Renders nothing until a PR exists, so projects that aren't published look unchanged.
 * Only http(s) URLs become links, as a cheap guard against anything odd in the data.
 */
export function StagingLink({ projectId, compact = false }: { projectId: string; compact?: boolean }) {
  const { data } = useStaging(projectId);
  const url = data?.prUrl;
  if (!url || !/^https?:\/\//.test(url)) return null;
  const link = (
    <a className="btn-outline" href={url} target="_blank" rel="noreferrer" style={{ display: "inline-block", textDecoration: "none" }}>
      View PR on GitHub
    </a>
  );
  if (compact) return <p style={{ margin: "8px 0" }}>{link}</p>;
  return (
    <div className="side-card">
      <h3>Pull request</h3>
      <p>Merged work is collected in one pull request on the project's fork.</p>
      <div style={{ marginTop: 10 }}>{link}</div>
    </div>
  );
}
