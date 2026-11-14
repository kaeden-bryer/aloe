# aloe-sandbox-ccf

`aloe-sandbox` plus pre-installed dependencies for the demo project, the
[Cloud Carbon Footprint fork](https://github.com/kaeden-bryer/cloud-carbon-footprint)
(Yarn Berry monorepo; we work on `packages/aws`).

Why a derived image? A full `yarn install` at task time took 11 minutes (the
Docker bind mount is slow). Baking a scoped install into the image takes the
test run down to about 30 s and works fully offline.

```sh
docker build -t aloe-sandbox docker/sandbox      # base image first
docker/sandbox-ccf/build.sh                       # builds aloe-sandbox-ccf at the pinned commit
docker/sandbox-ccf/build.sh <other-commit>        # rebuild when yarn.lock changes
```

## How it works

- Dependencies live in `/opt/ccf/node_modules`. The helper `ccf-link` symlinks
  that into the mounted worktree (`/work/node_modules`); `node_modules` is
  git-ignored, so `git diff` never sees it.
- Workspace links (`common`, `core`, `aws`) point at `/work/packages/*`, so edits
  to those packages are what the tests run against.
- Test command used in the TaskSpecs: `ccf-link && cd packages/aws && ../../node_modules/.bin/jest`
  (plain `jest`, not `yarn test`, which adds coverage and lerna).
- The agent runs test-mode containers with `--network none`; code/review runs keep
  the network because the model API needs it.

The image is tied to a commit: rebuild whenever `yarn.lock` or `package.json` change.
