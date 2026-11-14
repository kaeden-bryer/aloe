# aloe-sandbox

The container the `claude-sdk` provider (apps/agent) runs model work in.

```sh
docker build -t aloe-sandbox docker/sandbox
# optional, for reproducibility:
docker build -t aloe-sandbox --build-arg SDK_VERSION=<version> docker/sandbox
```

## How the agent uses it

| Step | Command (simplified) |
|---|---|
| code | `docker run --rm -e MODE=code -e ANTHROPIC_API_KEY -v <worktree>:/work -v <taskdir>:/task:ro aloe-sandbox` |
| review | same with `MODE=review` and `/work` mounted `:ro` |
| test | `docker run --rm --entrypoint sh -v <worktree>:/work aloe-sandbox -c "<spec.testCommand>"` (no API key) |

`runner.mjs` reads only `/task/spec.json` (the maintainer-approved TaskSpec, never raw
issue text) and, for review, `/task/patch.diff`. It prints progress lines, then one
JSON line as its answer. The host computes the patch itself with `git diff` after
the container exits. The agent also adds `--memory 4g --cpus 2 --pids-limit 512
--cap-drop ALL --security-opt no-new-privileges` and kills the container by name
(`docker kill`) if the lease is lost or the donor stops the agent.

## What it protects against

- **Filesystem:** the model and the repo's test suite see only the task worktree and
  the task files, not the donor's home directory, SSH keys, browser profiles or
  other repos.
- **Resources:** memory, CPU and process limits stop a runaway test from taking the
  machine down.
- **Repo-supplied config:** the runner ignores `.claude/` settings in the repo, and
  the host restores the worktree's `.git` pointer after each run so a hostile
  `.git/config` written inside the container can't make host-side `git` run code.

## What it does not protect against

- **Network:** egress is open, because the model API has to be reachable. Code in the
  container can reach any host, including the donor's LAN. Next step: an egress
  allowlist (an HTTP proxy that only permits `api.anthropic.com` and package
  registries, or `--network none` plus a sidecar proxy).
- **The API key:** it's in the container's environment, so code running there could
  read and send it out. Use a key dedicated to Aloe with a spend limit.
- **Kernel escapes:** Docker shares the host kernel. For untrusted work at scale, use
  gVisor (`--runtime=runsc`) or a microVM such as Firecracker.

Inside the container, `git` commands in `/work` fail: the worktree's `.git` file
points at the host's clone, which isn't mounted. That's intentional.
