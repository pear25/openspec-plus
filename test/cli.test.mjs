// End-to-end tests against the real `openspec` CLI (skipped when it is not installed).
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, test } from "node:test";
import { fileURLToPath } from "node:url";

const BIN = join(dirname(fileURLToPath(import.meta.url)), "..", "bin", "openspec-plus.mjs");
const hasOpenspec = spawnSync("openspec", ["--version"]).status === 0;

const SPEC = `# auth/login

## Purpose
Lets users sign in with email and password and stay signed in.

## Requirements

### Requirement: Password login
The system SHALL sign users in with email and password.

#### Scenario: Valid credentials
- **WHEN** a user submits a correct email and password
- **THEN** a session is created

#### Scenario: Auth service timeout
- **WHEN** the auth service does not respond within 2s
- **THEN** the user sees "try again" and no session is created
`;

const DELTA = `## ADDED Requirements

### Requirement: Lockout
The system SHALL lock an account after 5 failed logins.

#### Scenario: Fifth failure locks
- **WHEN** a user fails to log in 5 times in a row
- **THEN** the account is locked

#### Scenario: Lock store unavailable
- **WHEN** the lock store cannot be reached
- **THEN** login is refused with "try again later" and an alert is raised

## MODIFIED Requirements

### Requirement: Password login
The system SHALL sign users in with email and password unless locked.

#### Scenario: Valid credentials
- **WHEN** an unlocked user submits a correct email and password
- **THEN** a session is created
`;

const concernRows = (overrides = {}) => {
  const rows = {
    "Dependency failure": "Covered - Requirement: Lockout / Scenario: Lock store unavailable",
    "Timeouts and retries": "N/A - the lock store call reuses the existing client timeout",
    "Bad input and limits": "N/A - input is unchanged, still email and password",
    "Partial failure and concurrency": "N/A - counter increment is a single atomic store call",
    "Data and migration": "N/A - new keys only, no existing data is touched",
    "Rollout and rollback": "N/A - shipped behind the existing auth deploy, reverting the commit restores it",
    Observability: "Covered - Requirement: Lockout / Scenario: Lock store unavailable",
    "Security and privacy": "N/A - stores a counter keyed by user id, no new personal data",
    ...overrides,
  };
  return Object.entries(rows)
    .filter(([, v]) => v !== null)
    .map(([k, v]) => `| ${k} | ${v} |`)
    .join("\n");
};

const PROPOSAL = (rows = concernRows()) => `## Why
Brute-force attempts against login need to be stopped.

## What Changes
- Lock accounts after repeated failures.

## Operational Concerns

| Concern | Covered by / N/A reason |
| --- | --- |
${rows}
`;

const TASKS = (done) => `## 1. Lockout

- [${done ? "x" : " "}] 1.1 Count failures and lock; verify with unit test
- [${done ? "x" : " "}] 1.2 Simulate lock store outage (auth/login#lock-store-unavailable); verify refusal and alert
`;

function project(files) {
  const dir = mkdtempSync(join(tmpdir(), "osp-"));
  const all = { "openspec/config.yaml": "schema: spec-driven\n", "openspec/specs/auth/login/spec.md": SPEC, ...files };
  for (const [path, content] of Object.entries(all)) {
    if (content === null) continue;
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  execFileSync("git", ["init", "-q"], { cwd: dir });
  return dir;
}

function cli(dir, ...args) {
  const r = spawnSync("node", [BIN, ...args, "--root", dir], { encoding: "utf8", env: { ...process.env, GITHUB_ACTIONS: "" } });
  return { code: r.status, out: r.stdout + r.stderr };
}

const LOGIN_TESTS = `it("ok @spec auth/login#valid-credentials", () => {});
it("timeout @spec auth/login#auth-service-timeout", () => {});
`;

describe("check scenarios", { skip: !hasOpenspec && "openspec CLI not installed" }, () => {
  test("fails on an untested scenario and passes once tagged", () => {
    const dir = project({ "test/login.test.js": `it("ok @spec auth/login#valid-credentials", () => {});\n` });
    let r = cli(dir, "check", "scenarios");
    assert.equal(r.code, 1, r.out);
    assert.match(r.out, /openspec\/specs\/auth\/login\/spec\.md:15 .*auth\/login#auth-service-timeout is not proven/);

    writeFileSync(join(dir, "test/login.test.js"), LOGIN_TESTS);
    r = cli(dir, "check", "scenarios");
    assert.equal(r.code, 0, r.out);
  });

  test("tags in markdown and openspec/ do not count as proof", () => {
    const dir = project({ "README.md": LOGIN_TESTS, "openspec/notes.txt": LOGIN_TESTS });
    assert.equal(cli(dir, "check", "scenarios").code, 1);
  });

  test("orphan tags fail", () => {
    const dir = project({ "test/login.test.js": `${LOGIN_TESTS}// @spec auth/login#old-name\n` });
    const r = cli(dir, "check", "scenarios");
    assert.equal(r.code, 1);
    assert.match(r.out, /test\/login\.test\.js:3 .*@spec auth\/login#old-name matches no scenario/);
  });

  test("incomplete change scenarios are pending; complete ones are enforced and supersede MODIFIED", () => {
    const files = {
      "test/login.test.js": LOGIN_TESTS,
      "openspec/changes/add-lockout/proposal.md": PROPOSAL(),
      "openspec/changes/add-lockout/specs/auth/login/spec.md": DELTA,
      "openspec/changes/add-lockout/tasks.md": TASKS(false),
    };
    const dir = project(files);
    let r = cli(dir, "check", "scenarios");
    assert.equal(r.code, 0, r.out);
    assert.match(r.out, /Change add-lockout: 2 scenario\(s\) not yet proven/);

    writeFileSync(join(dir, "openspec/changes/add-lockout/tasks.md"), TASKS(true));
    r = cli(dir, "check", "scenarios");
    assert.equal(r.code, 1);
    assert.match(r.out, /add-lockout\/specs\/auth\/login\/spec\.md:\d+ .*#fifth-failure-locks is not proven .*all tasks checked/);
    // MODIFIED Password login dropped "Auth service timeout": no longer required...
    writeFileSync(
      join(dir, "test/login.test.js"),
      `it("@spec auth/login#valid-credentials")\nit("@spec auth/login#fifth-failure-locks")\nit("@spec auth/login#lock-store-unavailable")\n`,
    );
    r = cli(dir, "check", "scenarios");
    assert.equal(r.code, 0, r.out);
  });

  test("--junit: only passing tests count", () => {
    const dir = project({ "test/login.test.js": LOGIN_TESTS });
    const xml = (timeoutBody) =>
      `<testsuite><testcase name="ok @spec auth/login#valid-credentials"/><testcase name="t @spec auth/login#auth-service-timeout">${timeoutBody}</testcase></testsuite>`;
    writeFileSync(join(dir, "junit.xml"), xml("<failure/>"));
    let r = cli(dir, "check", "scenarios", "--junit", join(dir, "junit.xml"));
    assert.equal(r.code, 1);
    assert.match(r.out, /auth-service-timeout has failing tests/);

    writeFileSync(join(dir, "junit.xml"), `<testsuite><testcase name="ok @spec auth/login#valid-credentials"/></testsuite>`);
    r = cli(dir, "check", "scenarios", "--junit", join(dir, "junit.xml"));
    assert.equal(r.code, 1);
    assert.match(r.out, /tagged in source, but no passing test in the JUnit report/);

    writeFileSync(join(dir, "junit.xml"), xml(""));
    assert.equal(cli(dir, "check", "scenarios", "--junit", join(dir, "junit.xml")).code, 0);
  });

  test("baseline ratchet and manual proofs", () => {
    const dir = project({});
    assert.equal(cli(dir, "check", "--update-baseline").code, 0);
    const baseline = JSON.parse(readFileSync(join(dir, "openspec/plus-baseline.json"), "utf8"));
    assert.deepEqual(baseline.unproven, ["auth/login#auth-service-timeout", "auth/login#valid-credentials"]);
    assert.equal(cli(dir, "check").code, 0);

    writeFileSync(join(dir, "login.test.js"), `// @spec auth/login#valid-credentials\n`);
    let r = cli(dir, "check");
    assert.equal(r.code, 0);
    assert.match(r.out, /Baseline lists auth\/login#valid-credentials, which is now proven/);

    writeFileSync(join(dir, "openspec/plus-baseline.json"), "{}");
    writeFileSync(join(dir, "openspec/plus.json"), JSON.stringify({ manual: { "auth/login#auth-service-timeout": "chaos test in staging, runbook R-12" } }));
    r = cli(dir, "check");
    assert.equal(r.code, 0, r.out);
  });

  test("ids lists scenario IDs", () => {
    const dir = project({
      "openspec/changes/add-lockout/proposal.md": PROPOSAL(),
      "openspec/changes/add-lockout/specs/auth/login/spec.md": DELTA,
    });
    const r = cli(dir, "ids", "add-lockout");
    assert.match(r.out, /auth\/login#lock-store-unavailable\tLockout › Lock store unavailable  \[pending change add-lockout\]/);
  });
});

describe("check concerns", { skip: !hasOpenspec && "openspec CLI not installed" }, () => {
  const lockout = (proposal, tasks = TASKS(false)) =>
    project({
      "openspec/changes/add-lockout/proposal.md": proposal,
      "openspec/changes/add-lockout/specs/auth/login/spec.md": DELTA,
      "openspec/changes/add-lockout/tasks.md": tasks,
    });

  test("a complete, consistent proposal passes", () => {
    const r = cli(lockout(PROPOSAL()), "check", "concerns");
    assert.equal(r.code, 0, r.out);
  });

  test("missing section, missing rows, bare N/A, unknown requirement/scenario", () => {
    assert.match(cli(lockout("## Why\nBrute force needs stopping now.\n\n## What Changes\n- x\n"), "check", "concerns").out, /no `## Operational Concerns` section/);

    const r = cli(
      lockout(
        PROPOSAL(
          concernRows({
            Observability: null,
            "Timeouts and retries": "N/A",
            "Data and migration": "N/A - not applicable to this change",
            "Bad input and limits": "Covered - Requirement: Rate limit / Scenario: Too many",
            "Dependency failure": "Covered - Requirement: Lockout / Scenario: Store down",
          }),
        ),
      ),
      "check",
      "concerns",
    );
    assert.equal(r.code, 1);
    assert.match(r.out, /missing the "Observability" row/);
    assert.match(r.out, /"Timeouts and retries": N\/A needs a reason/);
    assert.match(r.out, /"Data and migration": N\/A needs a reason/);
    assert.match(r.out, /Requirement "Rate limit" is not ADDED or MODIFIED/);
    assert.match(r.out, /Requirement "Lockout" has no scenario "Store down"/);
  });

  test("covered scenarios need a task that references them", () => {
    const r = cli(lockout(PROPOSAL(), "## 1. Lockout\n\n- [ ] 1.1 Implement lockout; verify with unit test\n"), "check", "concerns");
    assert.equal(r.code, 1);
    assert.match(r.out, /tasks\.md has no task exercising auth\/login#lock-store-unavailable/);
  });

  test("baselined changes are exempt", () => {
    const dir = lockout("## Why\nBrute force needs stopping now.\n\n## What Changes\n- x\n");
    cli(dir, "check", "concerns", "--update-baseline");
    assert.deepEqual(JSON.parse(readFileSync(join(dir, "openspec/plus-baseline.json"), "utf8")).concerns, ["add-lockout"]);
    assert.equal(cli(dir, "check", "concerns").code, 0);
  });
});
