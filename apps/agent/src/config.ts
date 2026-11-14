/** The agent's on-disk config: `$ALOE_HOME/agent.json`, written by `pair`. */
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { Schedule } from "@aloe/core/contracts";

export const AgentConfig = z.object({
  serverUrl: z.url(),
  deviceId: z.string(),
  token: z.string(),
  donorId: z.string(),
  schedule: Schedule.optional(),
});
export type AgentConfig = z.infer<typeof AgentConfig>;

/** ALOE_HOME lets one machine run several "donors" for the demo, each with its own config and caches. */
export function aloeHome(): string {
  return process.env.ALOE_HOME || join(homedir(), ".aloe");
}

export const configPath = (home = aloeHome()) => join(home, "agent.json");

export async function loadConfig(home = aloeHome()): Promise<AgentConfig | null> {
  const path = configPath(home);
  if (!existsSync(path)) return null;
  return AgentConfig.parse(JSON.parse(await readFile(path, "utf8")));
}

export async function saveConfig(config: AgentConfig, home = aloeHome()): Promise<string> {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const path = configPath(home);
  // The token is a password for this device: owner read/write only.
  // `mode` only applies when the file is created, so chmod covers re-pairing.
  await writeFile(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
  await chmod(path, 0o600);
  return path;
}
