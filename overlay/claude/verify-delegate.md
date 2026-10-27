Verify an OpenSpec change with an independent reviewer: hand it to the
`openspec-verifier` subagent, which starts with a fresh context and never sees
how the code was written.

1. **Select the change.** Use the name given. Otherwise infer it from the
   conversation, or auto-select if `openspec list --json` shows exactly one
   active change; if it is still ambiguous, show the active changes and ask.
   Announce: "Verifying change: <name>".

2. **Delegate.** Call the Agent tool with `subagent_type: "openspec-verifier"`
   and this prompt, filled in and nothing more:

   > Verify the OpenSpec change `<name>` in the repository at `<absolute repo path>`.

   Do NOT add a summary of the implementation, what was changed, what you
   believe works, or which issues are known. The point is that the verifier
   forms its own view from the repository.

3. **Relay.** Show the verifier's report to the user verbatim. Do not soften,
   re-grade or argue with findings. If you disagree with one, say so separately
   after the report, with evidence.

If the Agent tool or the `openspec-verifier` subagent is unavailable, say so and
tell the user to run `/opsx:verify <name>` in a fresh Claude Code session
instead. Do not verify in this context.
