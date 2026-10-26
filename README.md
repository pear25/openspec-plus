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
CLI and its upgrades; this repo layers extra rules on top.

## What it adds

| # | Gap | Fix | Status |
|---|-----|-----|--------|
| 4 | Production behavior (timeouts, retries, rollback, observability, ...) is never specced, so it is never built | Every proposal must address 8 operational concerns, each **Covered** by a named requirement or **N/A** with a reason specific to the change. Covered concerns need a failure-path scenario, a design that agrees, and a task that exercises the failure. | ✅ Done |
| 3 | The implementer verifies its own work | `/opsx:verify` enabled globally (checks code against the change before archive) | ✅ Enabled. Planned: run it in a fresh-context subagent |
| 1 | A partial `MODIFIED` requirement silently deletes text at archive | Upstream schema already instructs "copy the whole block" | ✅ Instructions. Planned: mechanical pre-archive check |
| 2 | Nothing links a spec scenario to the check that proves it | Scenario IDs derived from spec paths + a CI check that fails on unproven scenarios | 🔜 Planned |
| 5 | Spec archived in a different PR from the code | CI check: code change with an un-archived change folder fails | 🔜 Planned |
| 6 | Hotfixes outside OpenSpec make the spec lie | Scheduled drift audit, spec vs code | 🔜 Planned |
| 7 | Hard rules rely on someone reading the spec right | Template CI step for per-repo build gates | 🔜 Planned |

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

## Install

Prerequisites: `git`, Node.js, and the official OpenSpec CLI.

```bash
brew install openspec            # or: npm install -g @fission-ai/openspec@latest

git clone https://github.com/pear25/openspec-plus.git ~/code/openspec-plus
~/code/openspec-plus/install.sh
```

`install.sh` sets your global OpenSpec workflow profile to
`propose, explore, apply, update, sync, archive, verify`, builds the schema, and
installs the skills into `~/.claude/`.

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

## Customizing

Edit files in `overlay/`, then run `scripts/sync.sh`.

- `overlay/overlay.yaml`: text under `artifacts.<id>.append` is appended to
  that artifact's instruction (`proposal`, `specs`, `design`, `tasks`).
  `apply.append` is appended to the apply instruction.
- `overlay/templates/<name>.md`: appended to the upstream template of the same name.

Only append. Never paste upstream text into the overlay; it would stop tracking
upstream changes.

Per-repo rules still go in that repo's `openspec/config.yaml` (`context`,
`rules`, `operations`); they stack on top of these global ones.

## Uninstall

```bash
rm -rf ~/.local/share/openspec/schemas/spec-driven   # back to the official schema
rm -rf ~/.claude/skills/openspec-* ~/.claude/commands/opsx
openspec config set profile core                      # optional: default workflows
```

## Repository layout

```
install.sh                 one-time setup
scripts/build-schema.mjs   package schema + overlay -> user-level schema
scripts/sync.sh            rebuild schema and reinstall skills/commands
overlay/overlay.yaml       appended instructions
overlay/templates/         appended template sections
```
