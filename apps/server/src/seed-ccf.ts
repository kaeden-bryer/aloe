/**
 * Demo project: Cloud Carbon Footprint (our fork), with 5 real, small tasks.
 *
 * Kept out of seed-data.ts, which mirrors the design prototype. Hidden tests
 * are written by the maintainer side (here: us, from the probe run that
 * checked each one FAILS on the unfixed code and PASSES with a reference fix).
 * The reference fixes are deliberately NOT stored anywhere in the seed.
 *
 * Tasks 1 and 2 are `feature`, 3 `docs`, 4 `tests`, 5 `interface`: the
 * interface one always routes to a maintainer (see packages/core/src/routing.ts).
 */
import type { HiddenTests, TaskSpec } from "@aloe/core";
import type { DesignProject } from "./seed-data.ts";

export const CCF_PROJECT_ID = "ccf";

export const CCF_SANDBOX_IMAGE = "aloe-sandbox-ccf";

/** Same shape as the design's projects, so the seed loop can treat it alike. */
export const CCF_DESIGN: DesignProject = {
  id: CCF_PROJECT_ID,
  name: "Cloud Carbon Footprint",
  owner: "Thoughtworks / open source",
  cause: "climate",
  also: [],
  type: "Open software",
  region: "Global",
  tagline: "Estimates the carbon footprint of your cloud usage.",
  about:
    "An open-source tool that turns cloud billing and usage data (AWS, Google Cloud, Azure) into energy and carbon estimates, so teams can see and cut the emissions of their cloud workloads. Aloe's demo works on a fork of the project, starting with its AWS package.",
  url: "https://github.com/kaeden-bryer/cloud-carbon-footprint",
  urlLabel: "github.com/kaeden-bryer/cloud-carbon-footprint",
  registry: "",
  tasks: [],
  decision: "",
};

export const CCF_REPO_URL = "https://github.com/kaeden-bryer/cloud-carbon-footprint";

export const CCF_BRIEF =
  "Cloud Carbon Footprint estimates cloud emissions from usage data. Accuracy of the estimates comes first: keep changes small and tested, never change the public estimate types or published methodology without a maintainer. Work happens in packages/aws; run tests with the testCommand in the task.";

export interface CcfTask {
  title: string;
  spec: TaskSpec;
  /** Higher is claimed first. */
  priority: number;
  hiddenTests?: HiddenTests;
}

export const CCF_TASKS: CcfTask[] = [
  {
    // The DEMO task: tiny and exact on purpose, so the live demo is fast (one file edited, one
    // test file run, a few model turns). It names the file, the change and the test, so the model
    // doesn't explore. Dispensable: nothing else depends on it. Claimed first (priority 10).
    title: "Classify Amazon Q Business Pro index hours as unknown",
    spec: {
      goal:
        "In packages/aws/src/lib/CostAndUsageTypes.ts, add exactly one new entry to the UNKNOWN_USAGE_TYPES array: the string 'Q-Business-Pro-Index-Hours' with the trailing comment // Amazon Q Business Pro knowledge index (managed service, no direct hardware mapping). Put it directly after the existing 'Q-Business-Starter-Index-free' entry. Then, in packages/aws/src/__tests__/AWSInstanceTypes.test.ts, add one new `it` inside the existing describe block that imports UNKNOWN_USAGE_TYPES from '../lib/CostAndUsageTypes' and expects it toContain 'Q-Business-Pro-Index-Hours'. Change nothing else; do not explore other files.",
      acceptanceCriteria: [
        "UNKNOWN_USAGE_TYPES contains 'Q-Business-Pro-Index-Hours' with a trailing comment, right after 'Q-Business-Starter-Index-free'",
        "AWSInstanceTypes.test.ts has one new test asserting the entry is present",
        "No other files change and the test file passes",
      ],
      filesInScope: ["packages/aws/src/lib/CostAndUsageTypes.ts", "packages/aws/src/__tests__/AWSInstanceTypes.test.ts"],
      category: "feature",
      // Only this one jest file: seconds instead of the whole aws suite.
      testCommand: "ccf-link && cd packages/aws && ../../node_modules/.bin/jest src/__tests__/AWSInstanceTypes.test.ts",
      maxTurns: 8,
    },
    priority: 10,
    hiddenTests: {
      command: "ccf-link && cd packages/aws && ../../node_modules/.bin/jest hidden_demoUnknownType.test.ts",
      files: [
        {
          path: "packages/aws/src/__tests__/hidden_demoUnknownType.test.ts",
          content:
            "import { UNKNOWN_USAGE_TYPES } from '../lib/CostAndUsageTypes'\n\ndescribe('demo unknown usage type (hidden)', () => {\n  it('lists Q-Business-Pro-Index-Hours once and keeps existing entries', () => {\n    expect(UNKNOWN_USAGE_TYPES.filter((t) => t === 'Q-Business-Pro-Index-Hours')).toHaveLength(1)\n    expect(UNKNOWN_USAGE_TYPES).toContain('Q-Business-Starter-Index-free')\n    expect(new Set(UNKNOWN_USAGE_TYPES).size).toBe(UNKNOWN_USAGE_TYPES.length)\n  })\n})\n",
        },
      ],
    },
  },
  {
    "title": "Fix infinite loop in ServiceWrapper.getQueryByInterval",
    "spec": {
      "goal": "ServiceWrapper.getQueryByInterval in packages/aws/src/lib/ServiceWrapper.ts splits a date range into consecutive intervals of N days and calls a function for each, but it never advances correctly: for ranges longer than the interval (e.g. 30 days over 2025-10-01..2025-12-30) the while loop never terminates and exhausts memory. Rewrite the loop so it produces contiguous, non-overlapping intervals that start at `start`, each at most `intervalInDays` long, with the last one ending exactly at `end`, and always terminates. Extra args must still be passed through to the function and the result array must contain one result per interval. Add a unit test in packages/aws/src/__tests__/ServiceWrapper.test.ts.",
      "acceptanceCriteria": [
        "getQueryByInterval terminates for any start < end and any intervalInDays >= 1",
        "Intervals are contiguous (each start equals previous end), non-overlapping, first starts at start and last ends at end",
        "A range shorter than the interval results in exactly one call (start, end)",
        "Extra arguments are forwarded to the callback",
        "A new unit test covering a multi-interval range is added to ServiceWrapper.test.ts and the aws test suite passes"
      ],
      "filesInScope": [
        "packages/aws/src/lib/ServiceWrapper.ts",
        "packages/aws/src/__tests__/ServiceWrapper.test.ts"
      ],
      "category": "feature",
      "testCommand": "ccf-link && cd packages/aws && ../../node_modules/.bin/jest",
      "sourceIssue": 1390
    },
    "priority": 5,
    "hiddenTests": {
      "command": "ccf-link && cd packages/aws && ../../node_modules/.bin/jest hidden_getQueryByInterval.test.ts",
      "files": [
        {
          "path": "packages/aws/src/__tests__/hidden_getQueryByInterval.test.ts",
          "content": "import { ServiceWrapper } from '../lib/ServiceWrapper'\n\ndescribe('ServiceWrapper.getQueryByInterval (hidden)', () => {\n  const wrapper = new ServiceWrapper(undefined as any, undefined as any, undefined as any, undefined as any, undefined as any, undefined as any)\n  const DAY = 24 * 60 * 60 * 1000\n\n  const collect = async (days: number, start: Date, end: Date, extra?: any) => {\n    const calls: Array<[Date, Date, any]> = []\n    await wrapper.getQueryByInterval(\n      days,\n      (s: Date, e: Date, p?: any) => {\n        if (calls.length > 500) throw new Error('runaway: too many intervals')\n        calls.push([s, e, p])\n        return [s, e] as any\n      },\n      start,\n      end,\n      ...(extra === undefined ? [] : [extra]),\n    )\n    return calls\n  }\n\n  it('terminates and covers a long range with contiguous, non-overlapping intervals', async () => {\n    const start = new Date('2025-10-01T00:00:00Z')\n    const end = new Date('2025-12-30T00:00:00Z')\n    const calls = await collect(30, start, end)\n    expect(calls.length).toBeGreaterThanOrEqual(3)\n    expect(calls.length).toBeLessThanOrEqual(4)\n    expect(calls[0][0].getTime()).toBe(start.getTime())\n    expect(calls[calls.length - 1][1].getTime()).toBe(end.getTime())\n    for (let i = 0; i < calls.length; i++) {\n      expect(calls[i][1].getTime()).toBeGreaterThan(calls[i][0].getTime())\n      expect(calls[i][1].getTime() - calls[i][0].getTime()).toBeLessThanOrEqual(30 * DAY + DAY / 24)\n      if (i > 0) expect(calls[i][0].getTime()).toBe(calls[i - 1][1].getTime())\n    }\n  })\n\n  it('makes a single call when the range is shorter than the interval', async () => {\n    const start = new Date('2025-10-01T00:00:00Z')\n    const end = new Date('2025-10-10T00:00:00Z')\n    const calls = await collect(30, start, end)\n    expect(calls).toHaveLength(1)\n    expect(calls[0][0].getTime()).toBe(start.getTime())\n    expect(calls[0][1].getTime()).toBe(end.getTime())\n  })\n\n  it('passes extra args through and returns one result per interval', async () => {\n    const start = new Date('2025-01-01T00:00:00Z')\n    const end = new Date('2025-03-15T00:00:00Z')\n    let n = 0\n    const res = await wrapper.getQueryByInterval(\n      30,\n      (() => {\n        if (++n > 500) throw new Error('runaway')\n        return 'x'\n      }) as any,\n      start,\n      end,\n      'arg',\n    )\n    expect(res.length).toBeGreaterThanOrEqual(2)\n    expect(res.every((r) => r === 'x')).toBe(true)\n    const calls = await collect(30, start, end, 'arg')\n    expect(calls.every((c) => c[2] === 'arg')).toBe(true)\n  })\n})\n"
        }
      ]
    }
  },
  {
    "title": "Classify three unsupported AWS usage types as unknown",
    "spec": {
      "goal": "Issue 1145 reports AWS usage types the estimator does not handle: KafkaServerless-PartitionHours, MI-AdvInstances-Hrs and VpcEndpoint-GWLBE-Hours (Gateway Load Balancer endpoints, MSK Serverless partitions, RDS advanced instances; the two others from the issue, KafkaServerless-ClusterHours and RDS:Multi-AZ-GP3-Storage, are already handled). Add the three missing usage types to UNKNOWN_USAGE_TYPES in packages/aws/src/lib/CostAndUsageTypes.ts with short explanatory comments, matching the style of neighbouring entries, so they are estimated as Unknown usage rather than failing.",
      "acceptanceCriteria": [
        "UNKNOWN_USAGE_TYPES contains KafkaServerless-PartitionHours, MI-AdvInstances-Hrs and VpcEndpoint-GWLBE-Hours",
        "Each new entry has a trailing comment",
        "No duplicate entries are introduced in UNKNOWN_USAGE_TYPES",
        "The aws package tests still pass"
      ],
      "filesInScope": [
        "packages/aws/src/lib/CostAndUsageTypes.ts"
      ],
      "category": "feature",
      "testCommand": "ccf-link && cd packages/aws && ../../node_modules/.bin/jest",
      "sourceIssue": 1145
    },
    "priority": 4,
    "hiddenTests": {
      "command": "ccf-link && cd packages/aws && ../../node_modules/.bin/jest hidden_unknownUsageTypes.test.ts",
      "files": [
        {
          "path": "packages/aws/src/__tests__/hidden_unknownUsageTypes.test.ts",
          "content": "import { UNKNOWN_USAGE_TYPES } from '../lib/CostAndUsageTypes'\n\ndescribe('issue 1145 usage types (hidden)', () => {\n  it.each([\n    'KafkaServerless-PartitionHours',\n    'MI-AdvInstances-Hrs',\n    'VpcEndpoint-GWLBE-Hours',\n  ])('classifies %s as unknown', (usageType) => {\n    const matches = (u: string) =>\n      UNKNOWN_USAGE_TYPES.some((t) => u.endsWith(t) || u.includes(t))\n    expect(matches(usageType)).toBe(true)\n    expect(matches(`EU-${usageType}`)).toBe(true)\n  })\n  it('does not break existing entries', () => {\n    expect(UNKNOWN_USAGE_TYPES).toContain('KafkaServerless-ClusterHours')\n    expect(new Set(UNKNOWN_USAGE_TYPES).size).toBe(UNKNOWN_USAGE_TYPES.length)\n  })\n})\n"
        }
      ]
    }
  },
  {
    "title": "Fix SCI embodied emissions formula in docs (TiR / ToR)",
    "spec": {
      "goal": "microsite/docs/HowItWorks/EmbodiedEmissions.md publishes the formula M = TE * (TR/EL) * (RR/TR), where TR is used for two different things (Time Reserved and Total Resources), so the factors appear to cancel. The current SCI spec uses M = TE * (TiR/EL) * (RR/ToR). Update the formula, the definition list below it, and the later explanatory paragraphs ('For TR (time reserved)...', 'For TR (total resources)...') to use TiR for Time Reserved and ToR for Total Resources. Do not change any numbers or other text.",
      "acceptanceCriteria": [
        "The formula reads M = TE * (TiR/EL) * (RR/ToR)",
        "The definitions list defines TiR (Time Reserved) and ToR (Total Resources) and no longer defines TR",
        "The explanatory paragraphs use **TiR (time reserved)** and **ToR (total resources)**",
        "No other content in the file changes"
      ],
      "filesInScope": [
        "microsite/docs/HowItWorks/EmbodiedEmissions.md"
      ],
      "category": "docs",
      "testCommand": "ccf-link && cd packages/aws && ../../node_modules/.bin/jest",
      "sourceIssue": 1379
    },
    "priority": 3,
    "hiddenTests": {
      "command": "ccf-link && cd packages/aws && ../../node_modules/.bin/jest hidden_docs.test.ts",
      "files": [
        {
          "path": "packages/aws/src/__tests__/hidden_docs.test.ts",
          "content": "import { readFileSync } from 'fs'\nimport { resolve } from 'path'\n\ndescribe('EmbodiedEmissions docs (hidden)', () => {\n  const doc = readFileSync(\n    resolve(__dirname, '../../../../microsite/docs/HowItWorks/EmbodiedEmissions.md'),\n    'utf8',\n  )\n  it('uses the SCI formula with TiR and ToR', () => {\n    expect(doc).toContain('M = TE * (TiR/EL) * (RR/ToR)')\n    expect(doc).not.toContain('M = TE * (TR/EL) * (RR/TR)')\n  })\n  it('defines TiR and ToR and no longer defines TR twice', () => {\n    expect(doc).toMatch(/TiR = Time Reserved/)\n    expect(doc).toMatch(/ToR = Total Resources/)\n    expect(doc).not.toMatch(/TR = Time Reserved/)\n    expect(doc).not.toMatch(/TR = Total Resources/)\n    expect(doc).toContain('**TiR (time reserved)**')\n    expect(doc).toContain('**ToR (total resources)**')\n  })\n})\n"
        }
      ]
    }
  },
  {
    "title": "Add unit tests for CostAndUsageReportsRow",
    "spec": {
      "goal": "packages/aws/src/lib/CostAndUsageReportsRow.ts has no dedicated test file. Create packages/aws/src/__tests__/CostAndUsageReportsRow.test.ts that constructs rows directly and covers vCpuHours for AWS Glue (4 vCPUs per usage), SimpleDB (1 per usage), Aurora/Neptune serverless ACUs (a quarter vCPU each), Fargate vCPU-Hours (1:1), and a plain EC2 row with a vCPU count from the report; Fargate GB-Hours usage unit normalization; and cloudProvider being 'AWS'. Do not modify production code.",
      "acceptanceCriteria": [
        "New file packages/aws/src/__tests__/CostAndUsageReportsRow.test.ts exists with at least 6 passing tests",
        "Tests cover Glue, SimpleDB, Aurora serverless, Fargate vCPU, and report-supplied vCPU cases",
        "A test covers Fargate-GB-Hours usage unit normalization",
        "No files outside the new test file are modified",
        "The full aws test suite passes"
      ],
      "filesInScope": [
        "packages/aws/src/__tests__/CostAndUsageReportsRow.test.ts"
      ],
      "category": "tests",
      "testCommand": "ccf-link && cd packages/aws && ../../node_modules/.bin/jest"
    },
    "priority": 2
  },
  {
    "title": "Add optional cloudProvider field to FootprintEstimate",
    "spec": {
      "goal": "Add an optional `cloudProvider?: string` field to the exported FootprintEstimate interface in packages/core/src/FootprintEstimate.ts so consumers can tag estimates with the provider they came from. This changes a public exported type consumed by the api, client, cli and every provider package, so it needs maintainer sign-off on naming and semantics before it is merged.",
      "acceptanceCriteria": [
        "FootprintEstimate has an optional cloudProvider?: string field",
        "No existing code breaks (type-check passes across packages that import FootprintEstimate)",
        "The change is documented in a changeset or comment"
      ],
      "filesInScope": [
        "packages/core/src/FootprintEstimate.ts"
      ],
      "category": "interface",
      "testCommand": "ccf-link && cd packages/aws && ../../node_modules/.bin/jest"
    },
    // Second in the queue (after the demo task) so the demo's escalation follows the first merge.
    "priority": 9
  }
];
