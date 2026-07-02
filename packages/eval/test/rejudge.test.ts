// Majority-of-3 flake absorption (routeExpecting): a single flaked judge sample
// must not redden the gate, a genuinely wrong surface must still fail, and the
// common all-clean path must cost exactly one judge call.

import { describe, expect, test } from "bun:test";
import type { WorkspacePlugin } from "@objectcore/registry-core";
import type { Judge, RouteDecision, TriggerSurface } from "../src/types";
import { routeExpecting } from "../src/judge";
import { runPluginActivation } from "../src/activation";

/** Scripted judge: returns the scripted skill per call (last entry repeats). */
class ScriptedJudge implements Judge {
  calls = 0;
  constructor(private readonly seq: (string | null)[]) {}
  async route(_prompt: string, _candidates: TriggerSurface[]): Promise<RouteDecision> {
    const skill = this.seq[Math.min(this.calls, this.seq.length - 1)] ?? null;
    this.calls++;
    return { skill, confidence: 0.9, reason: `scripted sample ${this.calls}` };
  }
}

const surfaces: TriggerSurface[] = [
  { id: "p:target-skill", plugin: "p", kind: "skill", name: "target-skill", description: "does the thing" },
];

describe("routeExpecting", () => {
  test("a clean first sample decides alone — one judge call", async () => {
    const judge = new ScriptedJudge(["target-skill"]);
    const r = await routeExpecting(judge, "prompt", surfaces, "target-skill");
    expect(r.passed).toBe(true);
    expect(r.samples).toBe(1);
    expect(judge.calls).toBe(1);
  });

  test("a flaked first sample is outvoted by the majority", async () => {
    const judge = new ScriptedJudge([null, "target-skill", "target-skill"]);
    const r = await routeExpecting(judge, "prompt", surfaces, "target-skill");
    expect(r.passed).toBe(true);
    expect(r.samples).toBe(3);
    expect(r.hits).toBe(2);
    expect(r.decision.skill).toBe("target-skill"); // the reported decision is a hit
  });

  test("a consistently wrong verdict still fails, stopping at the deciding miss", async () => {
    const judge = new ScriptedJudge([null]);
    const r = await routeExpecting(judge, "prompt", surfaces, "target-skill");
    expect(r.passed).toBe(false);
    expect(r.samples).toBe(2); // 2 misses = majority of 3 decided; no third call
    expect(judge.calls).toBe(2);
    expect(r.decision.skill).toBeNull(); // the reported decision is a miss
  });

  test("expect:null cases get the same absorption", async () => {
    const judge = new ScriptedJudge(["target-skill", null, null]);
    const r = await routeExpecting(judge, "prompt", surfaces, null);
    expect(r.passed).toBe(true);
    expect(r.hits).toBe(2);
  });
});

describe("runPluginActivation with a flaky judge", () => {
  const plugin = { manifest: { name: "p" }, dir: "", relDir: "p" } as WorkspacePlugin;

  test("passes the case and surfaces the flake in the detail", async () => {
    const judge = new ScriptedJudge([null, "target-skill", "target-skill"]);
    const results = await runPluginActivation(
      plugin,
      { cases: [{ prompt: "do the thing", expect: "target-skill" }] },
      surfaces,
      judge,
    );
    expect(results[0]!.passed).toBe(true);
    expect(results[0]!.detail).toContain("majority 2/3");
  });

  test("a real failure reports the majority verdict", async () => {
    const judge = new ScriptedJudge([null]);
    const results = await runPluginActivation(
      plugin,
      { cases: [{ prompt: "do the thing", expect: "target-skill" }] },
      surfaces,
      judge,
    );
    expect(results[0]!.passed).toBe(false);
    expect(results[0]!.detail).toContain("majority of 2");
  });
});
