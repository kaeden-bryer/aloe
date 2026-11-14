/**
 * aloe-agent CLI.
 *
 *   pair   --donor <id> --code <pairingCode> [--name <device>] [--server <url>] [--schedule <s>]
 *   run    [--mode code|verify|both] [--once] [--ignore-window] [--provider fake|claude-sdk|local-claude] [--schedule <s>]
 *   status
 *
 * Set ALOE_HOME to run several donors on one machine (default ~/.aloe).
 */
import { existsSync } from "node:fs";
import { hostname } from "node:os";
import { parseArgs } from "node:util";
import { Schedule } from "@aloe/core/contracts";
import { createClient } from "./client.ts";
import { aloeHome, configPath, loadConfig, saveConfig } from "./config.ts";
import { runLoop, type Mode } from "./loop.ts";
import { createProvider, isProviderName } from "./providers/index.ts";

const USAGE = `usage:
  aloe-agent pair --donor <id> --code <pairingCode> [--name <device>] [--server <url>] [--schedule overnight|workday|anytime]
  aloe-agent run [--mode code|verify|both] [--once] [--ignore-window] [--provider fake|claude-sdk|local-claude] [--schedule ...]
  aloe-agent status`;

// When run from the repo (the demo), pick up settings like ALOE_FAKE_DELAY_MS from
// the root .env. Variables already set in the shell win over the file.
const repoEnv = new URL("../../../.env", import.meta.url);
if (existsSync(repoEnv)) process.loadEnvFile(repoEnv);

const log = (line: string) => console.log(`${new Date().toISOString().slice(11, 19)} ${line}`);

async function pair(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      donor: { type: "string" },
      code: { type: "string" },
      name: { type: "string" },
      server: { type: "string" },
      schedule: { type: "string" },
    },
  });
  if (!values.donor || !values.code) fail("pair needs --donor and --code");
  const serverUrl = values.server ?? process.env.ALOE_SERVER_URL ?? "http://localhost:8787";
  const schedule = values.schedule ? parseSchedule(values.schedule) : undefined;

  const api = createClient({ serverUrl });
  const res = await api.pair({ donorId: values.donor, pairingCode: values.code, deviceName: values.name ?? hostname() });
  const path = await saveConfig({ serverUrl, deviceId: res.deviceId, token: res.token, donorId: values.donor, schedule });
  console.log(`paired device ${res.deviceId} for donor ${values.donor}; config saved to ${path}`);
}

async function runCommand(argv: string[]) {
  const { values } = parseArgs({
    args: argv,
    options: {
      mode: { type: "string", default: "both" },
      once: { type: "boolean", default: false },
      "ignore-window": { type: "boolean", default: false },
      provider: { type: "string" },
      schedule: { type: "string" },
    },
  });
  const mode = values.mode as Mode;
  if (!["code", "verify", "both"].includes(mode)) fail(`--mode must be code, verify or both`);
  const providerName = values.provider ?? process.env.ALOE_AGENT_PROVIDER ?? "fake";
  if (!isProviderName(providerName)) fail(`unknown provider "${providerName}"`);

  const home = aloeHome();
  const config = await loadConfig(home);
  if (!config) fail(`not paired yet (no ${configPath(home)}); run \`aloe-agent pair\` first`);
  const schedule = values.schedule ? parseSchedule(values.schedule) : (config.schedule ?? "anytime");

  const provider = createProvider(providerName, { aloeHome: home, log });
  const api = createClient({ serverUrl: config.serverUrl, token: config.token });

  // Ctrl-C once: finish cleanly (abort work, release the lease). Twice: exit now.
  const stop = new AbortController();
  const onSignal = (sig: string) => {
    if (stop.signal.aborted) process.exit(130);
    log(`${sig}: stopping (press Ctrl-C again to force)`);
    stop.abort();
  };
  process.on("SIGINT", () => onSignal("SIGINT"));
  process.on("SIGTERM", () => onSignal("SIGTERM"));

  await runLoop(
    { api, provider, log },
    { mode, schedule, once: values.once, ignoreWindow: values["ignore-window"], stopSignal: stop.signal },
  );
}

async function status() {
  const home = aloeHome();
  const config = await loadConfig(home);
  console.log(`ALOE_HOME: ${home}`);
  if (!config) {
    console.log("not paired");
    return;
  }
  console.log(`server:    ${config.serverUrl}`);
  console.log(`donor:     ${config.donorId}`);
  console.log(`device:    ${config.deviceId}`);
  console.log(`token:     ${config.token.slice(0, 4)}…`);
  console.log(`schedule:  ${config.schedule ?? "anytime"}`);
  try {
    await createClient({ serverUrl: config.serverUrl, timeoutMs: 3000 }).health();
    console.log("reachable: yes");
  } catch (err) {
    console.log(`reachable: no (${(err as Error).message})`);
    process.exitCode = 1;
  }
}

function parseSchedule(value: string) {
  const parsed = Schedule.safeParse(value);
  if (!parsed.success) fail(`--schedule must be one of ${Schedule.options.join(", ")}`);
  return parsed.data;
}

function fail(message: string): never {
  console.error(`aloe-agent: ${message}\n${USAGE}`);
  process.exit(2);
}

async function main() {
  const [command, ...rest] = process.argv.slice(2);
  switch (command) {
    case "pair":
      return pair(rest);
    case "run":
      return runCommand(rest);
    case "status":
      return status();
    default:
      fail(command ? `unknown command "${command}"` : "missing command");
  }
}

main().then(
  () => process.exit(process.exitCode ?? 0),
  (err: unknown) => {
    console.error(`aloe-agent: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  },
);
