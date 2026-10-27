// Operational Concerns lint: makes the proposal/tasks rules in overlay.yaml
// mechanical. What it cannot judge (is a scenario really a failure path, does
// design.md agree) is left to review and /opsx:verify.
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { sameName, scenarioId } from "./ids.mjs";

export const CONCERNS = [
  "Dependency failure",
  "Timeouts and retries",
  "Bad input and limits",
  "Partial failure and concurrency",
  "Data and migration",
  "Rollout and rollback",
  "Observability",
  "Security and privacy",
];

const key = (s) => s.toLowerCase().replace(/[^a-z]/g, "");
const MIN_REASON_WORDS = 3;
// Phrases that say "N/A" again without giving a reason.
const FILLER = /\b(not\s+(applicable|relevant|needed|required|affected)|does\s+not\s+apply|doesn't\s+apply|no\s+impact|n\/a|(to|for|in|by)\s+this\s+(change|feature|pr)|this\s+change|here|none|nothing|tbd|todo|same\s+as\s+above|see\s+above)\b/gi;

/** Parse the `## Operational Concerns` table. */
export function parseConcerns(markdown) {
  const lines = markdown.split("\n");
  const start = lines.findIndex((l) => /^##\s+Operational Concerns\b/i.test(l));
  if (start < 0) return null;
  const rows = [];
  for (let i = start + 1; i < lines.length && !/^##\s/.test(lines[i]); i++) {
    const line = lines[i].trim();
    if (!line.startsWith("|")) continue;
    const cells = line
      .replace(/^\||\|$/g, "")
      .split(/(?<!\\)\|/)
      .map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    if (key(cells[0]) === "concern") continue;
    rows.push({ concern: cells[0].replace(/\*\*/g, ""), value: cells[1] ?? "", line: i + 1 });
  }
  return { line: start + 1, rows };
}

/** Classify a "Covered by / N/A reason" cell. */
export function classify(raw) {
  const v = raw.replace(/\*\*|`/g, "").trim();
  if (!v) return { kind: "empty" };
  const na = v.match(/^N\s*\/?\s*A\b[\s:.,;\-–—]*(.*)$/i);
  if (na) {
    const reason = na[1].trim();
    const content = reason.replace(FILLER, " ").split(/\s+/).filter((w) => /[a-z0-9]/i.test(w));
    return content.length >= MIN_REASON_WORDS ? { kind: "na", reason } : { kind: "bare-na", reason };
  }
  if (/Requirement:/i.test(v)) {
    const pairs = v
      .replace(/^Covered\b[\s:\-–—]*/i, "")
      .split(";")
      .filter((p) => p.trim())
      .map((p) => {
        const m = p.match(/Requirement:\s*(.+?)\s*[\/,]?\s*Scenario:\s*(.+?)\s*[.,]?\s*$/i);
        return m ? { requirement: m[1], scenario: m[2] } : { error: p.trim() };
      });
    return { kind: "covered", pairs };
  }
  return { kind: "invalid" };
}

export function lintChange(root, change) {
  const findings = [];
  const proposalFile = join(change.dir, "proposal.md");
  const tasksFile = join(change.dir, "tasks.md");
  const err = (message, file = proposalFile, line) => findings.push({ level: "error", message: `Change ${change.name}: ${message}`, file, line });

  if (!existsSync(join(root, proposalFile))) {
    findings.push({ level: "info", message: `Change ${change.name}: no proposal.md yet, Operational Concerns not checked` });
    return { findings, failed: false };
  }
  if (change.error) {
    err(`cannot be read by openspec (${change.error})`);
    return { findings, failed: true };
  }

  const parsed = parseConcerns(readFileSync(join(root, proposalFile), "utf8"));
  if (!parsed) {
    err("proposal.md has no `## Operational Concerns` section (see the proposal template)");
    return { findings, failed: true };
  }

  const byKey = new Map();
  for (const row of parsed.rows) {
    const k = key(row.concern);
    if (!CONCERNS.some((c) => key(c) === k)) {
      findings.push({ level: "warning", message: `Change ${change.name}: unknown concern row "${row.concern}"`, file: proposalFile, line: row.line });
    } else if (byKey.has(k)) err(`concern "${row.concern}" is listed twice`, proposalFile, row.line);
    else byKey.set(k, row);
  }

  const liveReqs = change.deltas.filter((d) => d.operation === "ADDED" || d.operation === "MODIFIED");
  const covered = [];
  for (const concern of CONCERNS) {
    const row = byKey.get(key(concern));
    if (!row) {
      err(`Operational Concerns is missing the "${concern}" row`, proposalFile, parsed.line);
      continue;
    }
    const at = (msg) => err(`"${concern}": ${msg}`, proposalFile, row.line);
    const c = classify(row.value);
    if (c.kind === "empty") at("empty; mark it Covered or N/A with a reason");
    else if (c.kind === "bare-na") at(`N/A needs a reason specific to this change (got "${c.reason || "nothing"}")`);
    else if (c.kind === "invalid") at("write `Covered - Requirement: <name> / Scenario: <name>` or `N/A - <reason>`");
    else if (c.kind === "covered") {
      for (const p of c.pairs) {
        if (p.error) {
          at(`"${p.error}" must name both \`Requirement: <name>\` and \`Scenario: <name>\``);
          continue;
        }
        const reqs = liveReqs.filter((d) => sameName(d.requirement.name, p.requirement));
        if (!reqs.length) {
          at(`Requirement "${p.requirement}" is not ADDED or MODIFIED in this change's delta specs`);
          continue;
        }
        const hit = reqs.find((d) => d.requirement.scenarios?.some((s) => sameName(s.name, p.scenario)));
        if (!hit) at(`Requirement "${p.requirement}" has no scenario "${p.scenario}"`);
        else covered.push({ concern, id: scenarioId(hit.spec, p.scenario) });
      }
    }
  }

  if (existsSync(join(root, tasksFile))) {
    const taskLines = readFileSync(join(root, tasksFile), "utf8")
      .split("\n")
      .filter((l) => /^\s*[-*]\s*\[[^\]]*\]/.test(l));
    for (const { concern, id } of covered) {
      if (!taskLines.some((l) => l.includes(id))) {
        err(`tasks.md has no task exercising ${id} (covers "${concern}"); reference the ID in that task`, tasksFile);
      }
    }
  }

  return { findings, failed: findings.some((f) => f.level === "error") };
}

export function checkConcerns(project, { baseline }) {
  const skip = new Set(baseline.concerns ?? []);
  const findings = [];
  const failing = [];
  for (const change of project.changes) {
    const r = lintChange(project.root, change);
    if (r.failed) failing.push(change.name);
    if (skip.has(change.name)) continue;
    findings.push(...r.findings);
  }
  for (const name of skip) {
    if (!project.changes.some((c) => c.name === name)) {
      findings.push({ level: "warning", message: `Baseline lists change ${name}, which is no longer in flight; remove it from openspec/plus-baseline.json` });
    }
  }
  return { findings, failing: failing.sort() };
}
