# aloe-sandbox: where a donor's agent lets the model touch code.
# Build: docker build -t aloe-sandbox docker/sandbox
FROM node:22-slim

RUN apt-get update \
 && apt-get install -y --no-install-recommends git ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# The Agent SDK lives only in this image, never in the host agent's dependencies.
# Pin a version for reproducible results: --build-arg SDK_VERSION=x.y.z
ARG SDK_VERSION=latest
WORKDIR /opt/runner
RUN npm init -y > /dev/null \
 && npm install --omit=dev "@anthropic-ai/claude-agent-sdk@${SDK_VERSION}" \
 && npm cache clean --force
COPY runner.mjs /opt/runner/runner.mjs

# Non-root by default. (The host agent also passes --user <donor uid> so files
# written to the mounted worktree belong to the donor.)
RUN useradd --create-home --uid 10001 aloe
USER aloe

WORKDIR /work
ENTRYPOINT ["node", "/opt/runner/runner.mjs"]
