// Pre-archive MODIFIED check. Archive replaces a main-spec requirement with the
// delta's MODIFIED block wholesale, so a partial block silently deletes
// scenarios. Each dropped scenario must be listed, with a reason, under
// `## Dropped Scenarios` in the change's proposal.md.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractIds, sameName, scenarioId } from "./ids.mjs";
import { findLine } from "./openspec.mjs";

const SHRINK_RATIO = 0.5;
const MIN_REASON_WORDS = 3;

/** Parse `## Dropped Scenarios` bullets: `- <scenario-id> - <reason>`. */
export function parseDropped(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^##\s+Dropped Scenarios\b/i.test(l));
  const dropped = new Map();
  if (start < 0) return dropped;
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    const bullet = lines[i].match(/^\s*[-*]\s+(.*)$/);
    if (!bullet) continue;
    const [id] = extractIds(bullet[1]);
    if (!id) continue;
    const reason = bullet[1].replace(/`/g, "").replace(id, "").replace(/^[\s:\-–—]+/, "").trim();
    dropped.set(id, { reason, line: i + 1 });
  }
  return dropped;
}

export function checkModified(project) {
  const { root } = project;
  const findings = [];
  const specsById = new Map(project.specs.map((s) => [s.id, s]));

  for (const change of project.changes) {
    const proposalFile = join(change.dir, "proposal.md");
    const dropped = existsSync(join(root, proposalFile)) ? parseDropped(readFileSync(join(root, proposalFile), "utf8")) : new Map();
    const used = new Set();

    for (const d of change.deltas.filter((d) => d.operation === "MODIFIED")) {
      const file = join(change.dir, "specs", d.spec, "spec.md");
      const at = { file, line: findLine(root, file, `Requirement: ${d.requirement.name}`) };
      const err = (message) => findings.push({ level: "error", message: `Change ${change.name}: ${message}`, ...at });

      const spec = specsById.get(d.spec);
      if (!spec) {
        err(`MODIFIED targets ${d.spec}, which has no main spec; use ADDED for a new capability`);
        continue;
      }
      // MODIFIED may use the post-rename name.
      const rename = change.deltas.find((r) => r.operation === "RENAMED" && r.spec === d.spec && sameName(r.rename.to, d.requirement.name));
      const baseName = rename ? rename.rename.from : d.requirement.name;
      const base = spec.requirements.find((r) => sameName(r.name, baseName));
      if (!base) {
        err(`MODIFIED requirement "${d.requirement.name}" does not exist in ${spec.file}; match its header exactly, or use ADDED`);
        continue;
      }

      for (const sc of base.scenarios ?? []) {
        if (d.requirement.scenarios?.some((s) => sameName(s.name, sc.name))) continue;
        const id = scenarioId(d.spec, sc.name);
        const decl = dropped.get(id);
        if (!decl) {
          err(
            `MODIFIED "${d.requirement.name}" drops scenario ${id}; archive would delete it. Copy the whole requirement block from ${spec.file}, or list the scenario under \`## Dropped Scenarios\` in proposal.md with a reason`,
          );
        } else {
          used.add(id);
          if (decl.reason.split(/\s+/).filter(Boolean).length < MIN_REASON_WORDS) {
            findings.push({ level: "error", message: `Change ${change.name}: dropped scenario ${id} needs a reason`, file: proposalFile, line: decl.line });
          }
        }
      }

      const before = base.text?.trim().length ?? 0;
      const after = d.requirement.text?.trim().length ?? 0;
      if (before && after < before * SHRINK_RATIO) {
        findings.push({
          level: "warning",
          message: `Change ${change.name}: MODIFIED "${d.requirement.name}" description shrank from ${before} to ${after} characters; check no text was lost`,
          ...at,
        });
      }
    }

    for (const [id, decl] of dropped) {
      if (!used.has(id)) {
        findings.push({ level: "warning", message: `Change ${change.name}: ${id} is listed as dropped but no MODIFIED block drops it`, file: proposalFile, line: decl.line });
      }
    }
  }
  return { findings };
}
