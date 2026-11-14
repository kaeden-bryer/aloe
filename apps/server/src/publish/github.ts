/**
 * The little slice of the GitHub API the publisher needs, as an interface.
 *
 * Tests inject a fake; production wraps Octokit. Keeping it this small means
 * the publisher never touches anything we haven't thought about (no merging,
 * no deleting, no comments).
 */
import { Octokit } from "@octokit/rest";

export interface PullRequestRef {
  number: number;
  url: string;
}

export interface GithubClient {
  /** The open PR whose head is `branch` on this same repo, if any. */
  findOpenPr(args: { owner: string; repo: string; branch: string }): Promise<PullRequestRef | null>;
  /** Open a PR from `branch` into `base`, both on the same (fork) repo. */
  createPr(args: { owner: string; repo: string; branch: string; base: string; title: string; body: string }): Promise<PullRequestRef>;
  updatePr(args: { owner: string; repo: string; number: number; body: string }): Promise<PullRequestRef>;
}

export function octokitClient(token: string): GithubClient {
  const octokit = new Octokit({ auth: token });
  return {
    async findOpenPr({ owner, repo, branch }) {
      const { data } = await octokit.pulls.list({ owner, repo, state: "open", head: `${owner}:${branch}`, per_page: 5 });
      const pr = data[0];
      return pr ? { number: pr.number, url: pr.html_url } : null;
    },
    async createPr({ owner, repo, branch, base, title, body }) {
      const { data } = await octokit.pulls.create({ owner, repo, head: branch, base, title, body });
      return { number: data.number, url: data.html_url };
    },
    async updatePr({ owner, repo, number, body }) {
      const { data } = await octokit.pulls.update({ owner, repo, pull_number: number, body });
      return { number: data.number, url: data.html_url };
    },
  };
}
