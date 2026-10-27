

## openspec-plus gate (before merging specs)

Archive and sync both merge delta specs into the main specs. Run this BEFORE
any other step of either, and before `openspec archive`:

```bash
openspec-plus check
```

If it reports any error that names this change, or any `scenarios` or
`modified` error, STOP. Do not archive or sync. Show the errors to the user and explain
what to fix:

- `modified` errors: a MODIFIED block would delete scenarios from the main
  spec. Copy the whole requirement block, or list each intentionally dropped
  scenario under `## Dropped Scenarios` in proposal.md with a reason.
- `scenarios` errors: a scenario has no tagged, passing test. Write the test
  (tag `@spec <id>`), or add a gate or a manual entry in `openspec/plus.json`.
- `concerns` errors: fix proposal.md / tasks.md as described.

Continue only once `openspec-plus check` passes, or the user explicitly says to
go ahead anyway; in that case, repeat the outstanding errors in your final
message.
