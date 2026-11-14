import { describe, expect, it } from "vitest";
import type { Cause } from "@aloe/core/contracts";
import { buildChart, yAxisMax } from "../lib/chart";
import { scheduleLabel } from "../lib/catalog";
import { formatWhen, initials, pctHint, urlLabel } from "../lib/format";
import { buildSharePost, joinNames } from "../lib/share";

describe("chart scaling", () => {
  it("rounds the y-axis up to an even number, minimum 2", () => {
    expect(yAxisMax([])).toBe(2);
    expect(yAxisMax([0, 1])).toBe(2);
    expect(yAxisMax([3, 1])).toBe(4);
    expect(yAxisMax([4])).toBe(4);
  });

  it("turns counts into pixel segments, skipping zeros", () => {
    const chart = buildChart([{ label: "Mon", long: "Monday 9 Nov", total: 3, byProject: { a: 2, b: 1, c: 0 } }]);
    expect(chart.max).toBe(4);
    expect(chart.mid).toBe(2);
    expect(chart.days[0]!.segments).toEqual([
      { projectId: "a", n: 2, height: 88 }, // 2/4 of 180px, minus the 2px gap
      { projectId: "b", n: 1, height: 43 },
    ]);
  });
});

describe("share post", () => {
  const causes: Cause[] = [
    { id: "farming", emoji: "🐄", name: "Sustainable Farming", blurb: "" },
    { id: "health", emoji: "💊", name: "Health", blurb: "" },
  ];
  const landed = [
    { projectId: "farmos", name: "farmOS", emoji: "🐄", merged: 2, share: 0.2, released: true },
    { projectId: "accessmod", name: "AccessMod", emoji: "💊", merged: 2, share: 0.25, released: false },
  ];
  const causeOf = (id: string): Cause["id"] => (id === "farmos" ? "farming" : "health");

  it("builds the design's post text and card", () => {
    const post = buildSharePost(landed, causeOf, causes);
    expect(post.postText).toBe(
      "This week my unused AI quota shipped 4 verified improvements to open-source projects like farmOS and AccessMod, through Aloe. Every merge checked, my own work never interrupted. 🌱",
    );
    expect(post.headline).toBe("4 improvements shipped");
    expect(post.sub).toBe("to 2 open-source projects for sustainable farming, health");
    expect(post.chips).toEqual(["🐄 farmOS", "💊 AccessMod"]);
  });

  it("URL-encodes the intent links", () => {
    const post = buildSharePost(landed.slice(0, 1), causeOf, causes);
    expect(post.postText).toContain("open-source project farmOS");
    expect(post.links.x).toMatch(/^https:\/\/twitter\.com\/intent\/tweet\?text=This%20week/);
    expect(post.links.linkedIn.startsWith("https://www.linkedin.com/feed/?shareActive=true&text=")).toBe(true);
    expect(decodeURIComponent(post.links.bluesky.split("text=")[1]!)).toBe(post.postText);
  });

  it("joins names like the design", () => {
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A and B");
    expect(joinNames(["A", "B", "C", "D"])).toBe("A, B and 2 more");
  });
});

describe("text helpers", () => {
  it("labels donation windows", () => {
    expect(scheduleLabel("overnight")).toBe("Overnight");
    expect(scheduleLabel("anytime")).toBe("Whenever I am idle");
  });

  it("explains the quota share", () => {
    expect(pctHint(0)).toBe("At 0%, Aloe stays off. Raise it whenever you are ready.");
    expect(pctHint(50)).toBe("If 10 agent-hours would expire this week, about 5 of them go to your causes.");
  });

  it("formats activity times relative to now", () => {
    const now = new Date(2026, 10, 14, 15, 0).getTime(); // Sat 14 Nov, local time
    expect(formatWhen(new Date(2026, 10, 14, 2, 12).getTime(), now)).toBe("Today 02:12");
    expect(formatWhen(new Date(2026, 10, 13, 1, 6).getTime(), now)).toBe("Yesterday 01:06");
    expect(formatWhen(new Date(2026, 10, 11, 0, 24).getTime(), now)).toBe("Wed 00:24");
  });

  it("shortens URLs and names", () => {
    expect(urlLabel("https://world.openfoodfacts.org/")).toBe("world.openfoodfacts.org");
    expect(initials("Kaeden Bryer")).toBe("KB");
  });
});
