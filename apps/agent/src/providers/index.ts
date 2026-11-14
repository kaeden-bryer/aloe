import { ClaudeSdkProvider } from "./claude-sdk.ts";
import { FakeProvider } from "./fake.ts";
import { LocalClaudeProvider } from "./local-claude.ts";
import { PROVIDER_NAMES, type AgentProvider, type ProviderName } from "./types.ts";

export function isProviderName(name: string): name is ProviderName {
  return (PROVIDER_NAMES as readonly string[]).includes(name);
}

export function createProvider(
  name: ProviderName,
  ctx: { aloeHome: string; log: (line: string) => void },
): AgentProvider {
  switch (name) {
    case "fake":
      return new FakeProvider({ delayMs: Number(process.env.ALOE_FAKE_DELAY_MS ?? 3000) });
    case "claude-sdk":
      return new ClaudeSdkProvider(ctx);
    case "local-claude":
      return new LocalClaudeProvider(ctx);
  }
}
