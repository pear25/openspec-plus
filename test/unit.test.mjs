import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { classify, parseConcerns } from "../lib/concerns.mjs";
import { extractIds, extractTags, scenarioId, slug } from "../lib/ids.mjs";
import { readJunit } from "../lib/junit.mjs";

test("scenario IDs are spec path + slug", () => {
  assert.equal(slug("Auth service: Timeout (2s)!"), "auth-service-timeout-2s");
  assert.equal(slug("Café déjà vu"), "cafe-deja-vu");
  assert.equal(scenarioId("auth/login", "Valid credentials"), "auth/login#valid-credentials");
});

test("tags are extracted without surrounding punctuation", () => {
  assert.deepEqual(extractTags(`it("x @spec auth/login#a-b", () => {}) // @spec billing#c.`), ["auth/login#a-b", "billing#c"]);
  assert.deepEqual(extractTags("@spec not-an-id"), []);
  assert.deepEqual(extractIds("- [ ] 2.1 Simulate timeout (auth/login#auth-timeout)"), ["auth/login#auth-timeout"]);
});

test("N/A needs a specific reason", () => {
  assert.equal(classify("").kind, "empty");
  for (const bare of ["N/A", "n/a - not applicable", "NA: not relevant to this change", "**N/A** - none", "N/A - no impact here"]) {
    assert.equal(classify(bare).kind, "bare-na", bare);
  }
  assert.equal(classify("N/A - pure copy change, no new runtime dependency").kind, "na");
  assert.equal(classify("N/A: no network calls").kind, "na");
  assert.equal(classify("not sure yet").kind, "invalid");
});

test("Covered rows name requirement and scenario pairs", () => {
  assert.deepEqual(classify("Covered - Requirement: `Password login` / Scenario: Auth service timeout").pairs, [
    { requirement: "Password login", scenario: "Auth service timeout" },
  ]);
  const two = classify("Requirement: A / Scenario: B; Requirement: C, Scenario: D.");
  assert.deepEqual(two.pairs, [
    { requirement: "A", scenario: "B" },
    { requirement: "C", scenario: "D" },
  ]);
  assert.ok(classify("Covered - Requirement: A").pairs[0].error);
});

test("parseConcerns reads the table and stops at the next section", () => {
  const md = [
    "## Why",
    "x",
    "## Operational Concerns",
    "<!-- note -->",
    "| Concern | Covered by / N/A reason |",
    "| --- | --- |",
    "| **Observability** | N/A - CLI only, errors print to stderr |",
    "## Impact",
    "| Not | a row |",
  ].join("\n");
  const { rows, line } = parseConcerns(md);
  assert.equal(line, 3);
  assert.deepEqual(rows, [{ concern: "Observability", value: "N/A - CLI only, errors print to stderr", line: 7 }]);
  assert.equal(parseConcerns("## Why\n"), null);
});

test("JUnit: outcome per tagged scenario, from names and properties", () => {
  const dir = mkdtempSync(join(tmpdir(), "osp-junit-"));
  writeFileSync(
    join(dir, "a.xml"),
    `<testsuite>
      <testcase classname="login" name="ok &quot;x&quot; @spec auth/login#valid-credentials"/>
      <testcase classname="login" name="times out @spec auth/login#timeout"><failure message="boom"/></testcase>
      <testcase classname="login" name="skipped @spec auth/login#later"><skipped/></testcase>
      <testcase classname="t" name="test_rate_limit"><properties><property name="spec" value="api#rate-limit api#burst"/></properties></testcase>
      <testcase name="untagged"/>
    </testsuite>`,
  );
  const r = readJunit([dir]);
  assert.equal(r.get("auth/login#valid-credentials").passed, 1);
  assert.equal(r.get("auth/login#timeout").failed, 1);
  assert.equal(r.get("auth/login#later").skipped, 1);
  assert.equal(r.get("api#rate-limit").passed, 1);
  assert.equal(r.get("api#burst").passed, 1);
  assert.equal(r.size, 5);
});
