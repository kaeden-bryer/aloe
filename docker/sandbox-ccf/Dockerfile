# aloe-sandbox-ccf: aloe-sandbox + pre-installed deps for cloud-carbon-footprint (packages/aws + its workspace deps).
# Build context = a clean export of the repo at the target commit:
#   git -C ccf archive --prefix=ccf/ HEAD | tar -x -C ctx   (then: docker build -f Dockerfile.ccf -t aloe-sandbox-ccf:probe ctx/ccf)
FROM aloe-sandbox
USER root
WORKDIR /opt/ccf
COPY . /opt/ccf
# Scoped install: only @cloud-carbon-footprint/aws and the workspaces it depends on (common, core).
# Yarn is vendored (.yarn/releases/yarn-4.12.0.cjs) so no corepack/network bootstrap is needed.
# Repo says node>=24; image is node 22 -> YARN_IGNORE_NODE not needed for yarn itself but harmless.
RUN HUSKY=0 YARN_ENABLE_TELEMETRY=0 node .yarn/releases/yarn-4.12.0.cjs workspaces focus @cloud-carbon-footprint/aws \
 && node .yarn/releases/yarn-4.12.0.cjs cache clean --all 2>/dev/null; \
    rm -rf /tmp/.yarn /root/.yarn /opt/ccf/.git
# Point workspace links at /work (the mounted worktree) so edits to common/core are seen too.
RUN for p in common core aws; do ln -sfn /work/packages/$p /opt/ccf/node_modules/@cloud-carbon-footprint/$p; done \
 && chmod -R a+rX /opt/ccf
# Helper: symlink the baked deps into the mounted worktree (idempotent; node_modules is git-ignored).
COPY <<'SH' /usr/local/bin/ccf-link
#!/bin/sh
cd /work || exit 1
[ -e node_modules ] || ln -s /opt/ccf/node_modules node_modules
for d in /opt/ccf/packages/*/node_modules; do
  p=$(basename "$(dirname "$d")")
  if [ -d "packages/$p" ] && [ ! -e "packages/$p/node_modules" ]; then ln -s "$d" "packages/$p/node_modules"; fi
done
exit 0
SH
RUN chmod 755 /usr/local/bin/ccf-link
USER aloe
WORKDIR /work
