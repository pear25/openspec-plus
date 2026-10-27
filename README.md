# openspec-plus

Production-hardening rules for [OpenSpec](https://github.com/Fission-AI/OpenSpec),
installed machine-wide for [Claude Code](https://claude.com/claude-code).

OpenSpec makes an AI agent write down *what* it is going to build (proposal,
spec deltas, design, tasks) before it writes code, and keeps a living spec of
current behavior. That catches wrong requirements early. It does **not** make
the result production-ready:

- `openspec validate` checks the *format* of specs, never the code.
- The agent that writes the code also ticks its own tasks off.
- Archiving merges the spec deltas whether or not the code does what they say.
- Specs describe the happy path, and an agent builds what is specced and nothing else.

openspec-plus closes those gaps without forking OpenSpec. You keep the official
CLI and its upgrades; this repo layers extra rules on top, and a CI check
(`openspec-plus check`) enforces the parts that can be checked mechanically.

## What it adds

| # | Gap | Fix | Status |
|---|-----|-----|--------|
| 4 | Production behavior (timeouts, retries, rollback, observability, ...) is never specced, so it is never built | Every proposal must address 8 operational concerns, each **Covered** by a named requirement + failure-path scenario or **N/A** with a reason specific to the change. Covered scenarios need a task that exercises the failure. | ✅ Done, **enforced in CI** (`check concerns`) |
| 2 | Nothing links a spec scenario to the check that proves it | Scenario IDs derived from spec paths; tests carry `@spec <id>`; CI fails on scenarios with no (passing) test | ✅ Done, **enforced in CI** (`check scenarios`) |
| 3 | The implementer verifies its own work | `/opsx:verify` hands off to a read-only `openspec-verifier` subagent with a fresh context. Ticking every task triggers `check scenarios` on that change | ✅ Done |
| 1 | A partial `MODIFIED` requirement silently deletes text at archive | `check modified` fails when a MODIFIED block drops a scenario that isn't listed under `## Dropped Scenarios`. `/opsx:archive` and `/opsx:sync` run the check first | ✅ Done, **enforced in CI and before archive** |
| 5 | Spec archived in a different PR from the code | `check pr`: code plus an unarchived change fails; code with no spec work needs `No-Spec: <reason>` in the PR description | ✅ Done, **enforced in CI** |
| 6 | Hotfixes outside OpenSpec make the spec lie | Weekly Claude drift audit (read-only) that keeps one `spec-drift` issue up to date | ✅ Done (opt-in workflow, costs API tokens) |
| 7 | Hard rules rely on someone reading the spec right | Gates: commands in `openspec/plus.json` that prove scenarios, run by `check scenarios` | ✅ Done |

## How it works

OpenSpec resolves its workflow schema from three places and uses the first it finds:

```
1. <repo>/openspec/schemas/spec-driven/          project-level
2. ~/.local/share/openspec/schemas/spec-driven/  user-level   <- built by openspec-plus
3. <installed package>/schemas/spec-driven/      official default
```

Instead of keeping an edited copy of the schema (which would go stale),
openspec-plus stores only its additions and builds the user-level schema from
the **currently installed** official one:

```
official schema (from your installed openspec) --+
                                                 +--> scripts/build-schema.mjs --> ~/.local/share/openspec/schemas/spec-driven/
overlay/overlay.yaml      extra instructions  ---+      - keeps every upstream line untouched
overlay/templates/*.md    extra template text ---+      - appends ours after it
                                                        - runs `openspec schema validate`
```

So every repo on the machine picks up the rules automatically, and upstream
improvements still arrive on every OpenSpec upgrade. If upstream renames an
artifact the overlay targets, the build stops with an error rather than
producing a broken schema.

`openspec init` only writes skills into a single project's `.claude/`.
`scripts/sync.sh` runs it in a throwaway directory and copies the skills and
`/opsx:*` commands into `~/.claude/`, so they are available in every project.
Then `scripts/install-claude.mjs` adds openspec-plus behavior to them, again
by appending rather than rewriting upstream text:

- **`~/.claude/agents/openspec-verifier.md`**: our preamble (read-only, the
  implementer's claims aren't evidence, run `openspec-plus check` and the
  tagged tests, check that Covered/N/A concerns hold in the code) plus the
  upstream verify procedure, regenerated on every sync.
- **`/opsx:verify`**: passes only the change name to that subagent and relays
  its report verbatim, so the agent that wrote the code never grades it.
- **`/opsx:archive` and `/opsx:sync`**: run `openspec-plus check` first, and
  stop on errors unless you say to go ahead.

## CI checks

`openspec-plus check` runs the checks below and exits 1 on any error. `pr`
runs only when you pass `--base <ref>`, which the GitHub Action does on pull
requests. Name a check to run just that one: `openspec-plus check modified`.
The CLI reads specs and changes through `openspec show --json`, so it parses
exactly what OpenSpec does.

### `check scenarios`: every scenario is proven

Each scenario has an ID derived from its spec path and name:

```
openspec/specs/auth/login/spec.md  +  "#### Scenario: Auth service timeout"
  ->  auth/login#auth-service-timeout
```

A test proves a scenario by carrying `@spec <id>`, preferably in its name:

```ts
it("shows try again @spec auth/login#auth-service-timeout", async () => { ... });
```

```python
def test_auth_timeout(record_property):
    record_property("spec", "auth/login#auth-service-timeout")
```

`openspec-plus ids [<spec-or-change>]` lists the IDs.

What counts as proof:

- **Default:** a tag in any git-tracked or untracked (not ignored) file outside
  `openspec/` and `*.md`. Narrow it with `tests` globs in `openspec/plus.json`.
- **A gate** (see below) whose command exits 0.
- **With `--junit <file|dir>`:** only *passing* test cases in the JUnit XML
  count. The tag must be in the test name or classname, or in a `spec` property.
  Failing tests are reported as errors. Skipped tests and tags without a test
  result don't count.

Which scenarios are enforced:

| Scenario lives in | Enforced? |
|---|---|
| Main spec (`openspec/specs`) | Yes |
| Change whose `tasks.md` is fully checked | Yes. Its `MODIFIED`/`REMOVED` requirements replace the main ones |
| Change with unchecked tasks (or no `tasks.md`) | No, reported as pending |

The check also fails on:

- **Orphan tags**, i.e. tags pointing at a scenario that no longer exists (it
  was renamed or removed).
- **Duplicate scenario names** within a spec, since they would share an ID.

### Gates: hard rules as proof

Some rules aren't unit tests: "no personal data in logs", "p95 under 200 ms",
"no new dependency with a known CVE". Write the rule as a scenario, then name a
command that enforces it:

```json
{
  "gates": [
    { "name": "no PII in logs", "run": "npm run lint:no-pii", "proves": ["logging#no-personal-data"] },
    { "name": "login latency", "run": "k6 run perf/login.js", "proves": ["auth/login#p95-under-200ms"], "timeoutSeconds": 900 }
  ]
}
```

`check scenarios` runs each gate once, in order, from the project root. A zero
exit proves its scenarios. Any other exit fails them and prints the last lines
of output. Pass `--no-gates` (or `gates: false` in the Action) for a quick
local run; gated scenarios then count as proven, with a warning.

### `check modified`: MODIFIED blocks keep their scenarios

Archive (and sync) replaces a main-spec requirement with the MODIFIED block
wholesale. For every in-flight MODIFIED requirement, the check:

- fails if a scenario of the main-spec requirement is missing from the block,
  unless proposal.md lists it with a reason:
  ```
  ## Dropped Scenarios

  - auth/login#legacy-sso - SSO moves to the identity service in this change
  ```
- fails if the block's header matches no main-spec requirement (renames via
  `RENAMED` are followed).
- warns if the description shrank to less than half its length.

### `check pr`: code and spec land together

With `--base <ref>` it diffs the PR (falling back to `base..HEAD` on shallow CI
clones). If the PR changes code, meaning anything outside `openspec/`, `*.md`
and the `nonCode` globs in `openspec/plus.json`:

- every change folder the PR touches must be archived in the same PR;
- if the PR touches no change or spec at all, the PR description must contain
  `No-Spec: <reason>` (at least three words), e.g.
  `No-Spec: dependency bump for CVE-2026-1234, no behavior change`.

PRs that only touch the proposal pass, so specs can be reviewed before any code
exists. Outside GitHub Actions, pass the description with `--pr-body-file`.

### `check concerns`: Operational Concerns are real

For every in-flight change with a `proposal.md`:

- All 8 concern rows are present.
- Each row is either:
  - `N/A - <reason>`, with at least three meaningful words. Bare "N/A" and
    filler like "not applicable to this change" are rejected.
  - `Covered - Requirement: <name> / Scenario: <name>`, where both are
    `ADDED`/`MODIFIED` in the change's delta specs.
- If `tasks.md` exists, every Covered scenario's ID appears in a task line.

**Still judgment, not checked:** whether a Covered scenario really describes a
failure, whether an N/A reason is *true*, whether `design.md` agrees with the
proposal, and whether a tagged test really asserts the scenario's THEN. Those
stay with review and `/opsx:verify`.

### Adopting in an existing repo

```bash
openspec-plus check --update-baseline   # writes openspec/plus-baseline.json
```

The baseline records today's unproven scenarios and non-conforming in-flight
changes. CI then fails only on *new* gaps. Entries that get proven are flagged
as stale, so you can delete them and ratchet down. To prove a scenario that
can't be automated, give the reason in `openspec/plus.json`:

```json
{
  "tests": ["src/**/*.test.ts", "tests/**/*.py"],
  "manual": { "billing/invoice#printer-offline": "manual QA checklist QA-7, run each release" }
}
```

### GitHub Actions

Copy [`examples/openspec.yml`](examples/openspec.yml) to
`.github/workflows/openspec.yml`, or add the step yourself:

```yaml
- uses: pear25/openspec-plus@main   # pin to a SHA or tag
  with:
    junit: reports/junit.xml         # optional; omit to accept source tags
```

On `pull_request` events the Action also fetches the base commit and runs
`check pr`. The example workflow re-runs on `edited`, so adding a `No-Spec:`
line takes effect without a new push. Errors show up as annotations on the
spec, proposal or test line. Other CI systems:

```bash
npm install -g @fission-ai/openspec
npx -y github:pear25/openspec-plus check --junit reports/junit.xml --base origin/main --pr-body-file pr.md
```

### Drift audit

The mechanical checks can't tell that a hotfix changed behavior while someone
edited the test to match. [`examples/openspec-drift.yml`](examples/openspec-drift.yml)
runs [`drift/`](drift/action.yml) weekly. Claude reads each spec, follows the
`@spec` tags into the code, and writes a report. The report lists only drift it
can show, with spec and code `file:line`, plus "unlocated" requirements and the
specs it didn't get to. A deterministic step then opens or updates a single
issue labelled `spec-drift`, and closes it when no drift remains.

- Claude runs read-only: Read/Grep/Glob, `openspec`, `openspec-plus` and
  read-only git, plus Write for the report file only. The job has
  `contents: read`, so it can't push.
- It needs an `ANTHROPIC_API_KEY` (or `CLAUDE_CODE_OAUTH_TOKEN`) secret and
  costs API tokens per run. Bound the cost with `max-turns` and `specs`.
- It's still judgment: treat the issue as leads to confirm, not verdicts.

## Install

Prerequisites: `git`, Node.js 20.12+, and the official OpenSpec CLI.

```bash
brew install openspec            # or: npm install -g @fission-ai/openspec@latest

git clone https://github.com/pear25/openspec-plus.git ~/code/openspec-plus
~/code/openspec-plus/install.sh
```

`install.sh` does four things:

- sets your global OpenSpec workflow profile to
  `propose, explore, apply, update, sync, archive, verify`
- builds the schema
- installs the skills into `~/.claude/`
- links the `openspec-plus` CLI onto your PATH, so the agent can run
  `openspec-plus ids` and `openspec-plus check`

Then, in each repo where you want OpenSpec:

```bash
openspec init --tools none   # creates openspec/ only; the skills are already global
```

Check it worked:

```bash
openspec schema which spec-driven   # Source: user, shadows package
```

## Update

After upgrading OpenSpec, pulling this repo, or editing the overlay:

```bash
brew upgrade openspec                # if upgrading OpenSpec
git -C ~/code/openspec-plus pull     # if updating openspec-plus
~/code/openspec-plus/scripts/sync.sh
```

## Usage

In Claude Code, inside a repo with `openspec/`:

| Command | What it does |
|---------|--------------|
| `/opsx:explore` | Think a problem through before committing to a change |
| `/opsx:propose <idea>` | Create a change: proposal (with Operational Concerns), spec deltas, design, tasks |
| `/opsx:update` | Revise a change's planning artifacts and keep them consistent |
| `/opsx:apply` | Implement the tasks |
| `/opsx:verify` | Check the implementation against the change before archiving |
| `/opsx:sync` | Merge spec deltas into the main specs without archiving |
| `/opsx:archive` | Merge spec deltas into the main specs and archive the change |

Locally, `openspec-plus check` runs the same checks as CI, and
`openspec-plus ids <change>` lists the scenario IDs to tag tests with.

## Customizing

Edit files in `overlay/`, then run `scripts/sync.sh`.

- `overlay/overlay.yaml`: text under `artifacts.<id>.append` is appended to
  that artifact's instruction (`proposal`, `specs`, `design`, `tasks`).
  `apply.append` is appended to the apply instruction.
- `overlay/templates/<name>.md`: appended to the upstream template of the same name.

Only append. Never paste upstream text into the overlay; it would stop tracking
upstream changes.

Per-repo rules still go in that repo's `openspec/config.yaml` (`context`,
`rules`, `operations`); they stack on top of these global ones. Per-repo check
settings go in `openspec/plus.json` (see [CI checks](#ci-checks)).

- `overlay/claude/`: the verifier preamble, the `/opsx:verify` delegation and
  the archive/sync gate that `scripts/install-claude.mjs` applies.

If you change the overlay's required formats (the concern names, the
`Covered - Requirement: / Scenario:` syntax, `## Dropped Scenarios`, the `@spec`
tag), update `lib/` to match and run `npm test`.

## Uninstall

```bash
rm -rf ~/.local/share/openspec/schemas/spec-driven   # back to the official schema
rm -rf ~/.claude/skills/openspec-* ~/.claude/commands/opsx ~/.claude/agents/openspec-verifier.md
npm uninstall -g openspec-plus
openspec config set profile core                      # optional: default workflows
```

## Repository layout

```
install.sh                 one-time setup
scripts/build-schema.mjs   package schema + overlay -> user-level schema
scripts/sync.sh            rebuild schema and reinstall skills/commands
scripts/install-claude.mjs verifier subagent, /opsx:verify delegation, archive/sync gate
overlay/overlay.yaml       appended instructions
overlay/templates/         appended template sections
overlay/claude/            text for install-claude.mjs
bin/openspec-plus.mjs      CLI: `check`, `ids`
lib/                       scenarios, gates, concerns, modified, pr checks; JUnit reader
action.yml                 GitHub Action wrapping `openspec-plus check`
drift/                     GitHub Action: scheduled Claude drift audit
examples/                  workflows to copy into projects
test/                      `npm test` (integration tests need `openspec` on PATH)
```
