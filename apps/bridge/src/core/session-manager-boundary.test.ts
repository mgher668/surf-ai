import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import assert from "node:assert/strict";

test("SessionManager delegates context assembly to ContextEngine", () => {
  const source = readFileSync(join(import.meta.dirname, "session-manager.ts"), "utf8");

  for (const token of [
    "buildAdaptiveHandoff",
    "resolveDeltaSummary",
    "function normalizeContext",
    "function shouldRetrieveOlderContext",
    "function pickRecentWindow",
    "function collectEvidenceRefs",
    "function clipText",
    "retrieveSessionMessages"
  ]) {
    assert.equal(source.includes(token), false, `${token} should not be owned by SessionManager`);
  }

  assert.equal(source.includes("new ContextEngine("), true);
  assert.equal(source.includes("this.context.buildHandoff("), true);
});
