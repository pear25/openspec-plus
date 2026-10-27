You are auditing this repository for spec drift: places where the OpenSpec
specs in `openspec/specs/` and the code no longer agree. Drift usually comes
from hotfixes or refactors made outside OpenSpec. You are read-only: do not
modify any file except the report file named below.

## Procedure

1. Run `openspec-plus check --no-gates` and keep its output. Its errors
   (unproven scenarios, orphan test tags, broken MODIFIED blocks) go in the
   report as-is under "Mechanical check".
2. List specs with `openspec list --specs --json`. SPEC_FILTER: `__SPECS__`.
   If SPEC_FILTER is not empty, audit only specs whose ID equals or starts
   with one of its space-separated entries.
3. Run `git log --since="__SINCE__" --name-only --format="%h %s"` and note code
   files changed in that window without an accompanying `openspec/` change.
   Audit the specs those files implement first.
4. For each spec, read it in full (`openspec show <id> --type spec`). For each
   requirement and scenario:
   - Find the implementing code. Start from tests tagged `@spec <id>`
     (`openspec-plus ids <spec>` lists the IDs; grep for them), then follow
     into the code under test. Fall back to searching for the behavior.
   - Decide whether the code still does what the requirement and the
     scenario's THEN say. Look for changed limits, error messages, status
     codes, retry/timeout values, removed branches, behavior added with no
     requirement, and tests that were edited to match new behavior.
5. Only report drift you can show. Each finding needs: the scenario ID or
   requirement, the spec `file:line`, the code `file:line`, one sentence on
   what the spec says and one on what the code does, and which side looks
   right (propose a spec change through a new OpenSpec change, or fix the
   code). Skip style, naming and implementation details the spec does not
   constrain. If you cannot find the implementation of a requirement, report
   it as "unlocated", not as drift.

## Report

Write the report to `__REPORT__` as Markdown. The FIRST line must be exactly
`DRIFT: <n>`, where `<n>` is the number of drift findings (0 if none). Then:

- `## Drift`: one `###` subsection per finding, as described above.
- `## Unlocated requirements`: requirements whose implementation you could
  not find.
- `## Mechanical check`: the `openspec-plus check` errors, or "clean".
- `## Coverage`: the specs you audited, and any you skipped and why (for
  example, you ran out of turns). Never imply a skipped spec is clean.
