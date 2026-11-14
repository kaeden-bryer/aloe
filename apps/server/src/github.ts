/**
 * The small slice of GitHub the maintainer import needs.
 *
 * `GitHubClient` is an interface so tests hand the server a fake and never
 * touch the network; `octokitClient()` is the real one (Octokit + GITHUB_TOKEN).
 */
import { Octokit } from "@octokit/rest";
import type { Issue } from "./steward/index.ts";

export interface RepoRef {
  owner: string;
  repo: string;
}

export interface GitHubClient {
  /** The upstream repo if `ref` is a fork, otherwise null. */
  getParent(ref: RepoRef): Promise<RepoRef | null>;
  /** Open issues (never pull requests), newest first, at most `max`. */
  listOpenIssues(ref: RepoRef, opts: { label?: string; max: number }): Promise<Issue[]>;
}

/** "https://github.com/owner/repo(.git)(/...)" -> { owner, repo }; null for anything else. */
export function parseRepoUrl(url: string): RepoRef | null {
  const m = url.trim().match(/^https?:\/\/(?:www\.)?github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?(?:[#?].*)?$/i);
  if (!m) return null;
  return { owner: m[1]!, repo: m[2]! };
}

export function octokitClient(token = process.env.GITHUB_TOKEN): GitHubClient {
  // No token still works for public repos, just with a much lower rate limit.
  const octokit = new Octokit(token ? { auth: token } : {});
  return {
    async getParent(ref) {
      const { data } = await octokit.rest.repos.get({ owner: ref.owner, repo: ref.repo });
      return data.fork && data.parent ? { owner: data.parent.owner.login, repo: data.parent.name } : null;
    },
    async listOpenIssues(ref, { label, max }) {
      const out: Issue[] = [];
      // The issues endpoint also returns pull requests, so keep paging until we have `max` real issues.
      const pages = octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
        owner: ref.owner,
        repo: ref.repo,
        state: "open",
        labels: label,
        per_page: 100,
      });
      for await (const page of pages) {
        for (const i of page.data) {
          if (i.pull_request) continue;
          out.push({ number: i.number, title: i.title, body: i.body ?? "" });
          if (out.length >= max) return out;
        }
      }
      return out;
    },
  };
}
