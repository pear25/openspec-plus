// Scenario-to-test check: every scenario in force must be proven by a test.
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import { extractTags, sameName, scenarioId } from "./ids.mjs";
import { findLine } from "./openspec.mjs";

const run = promisify(execFile);
const LIVE_OPS = new Set(["ADDED", "MODIFIED"]);

/**
 * Work out which scenarios are in force.
 * - Main specs are in force, except requirements that a *complete* change (all
 *   tasks checked) removes or modifies: those are replaced by the change's delta.
 * - A complete change's ADDED/MODIFIED scenarios are in force: the implementer
 *   has claimed the work is done, so it must be proven now, not after archive.
 * - An incomplete change's scenarios are pending: reported, not enforced.
 */
export function inventory({ specs, changes }) {
  const enforced = new Map();
  const pending = new Map();
  const known = new Set();
  const duplicates = [];

  const entriesOf = (spec, file, requirements, source) => {
    const seen = new Map();
    const out = [];
    for (const req of requirements) {
      for (const sc of req.scenarios ?? []) {
        const id = scenarioId(spec, sc.name);
        if (seen.has(id)) duplicates.push({ id, file, names: [seen.get(id), sc.name] });
        else seen.set(id, sc.name);
        known.add(id);
        out.push({ id, spec, requirement: req.name, scenario: sc.name, file, source });
      }
    }
    return out;
  };

  const superseded = new Map(); // spec -> requirement names replaced by complete changes
  for (const change of changes.filter((c) => c.complete)) {
    for (const d of change.deltas) {
      const names = superseded.get(d.spec) ?? [];
      if (d.operation === "REMOVED" || d.operation === "MODIFIED") names.push(d.requirement.name);
      superseded.set(d.spec, names);
    }
    // MODIFIED may use the post-rename name; supersede the original too.
    for (const d of change.deltas.filter((d) => d.operation === "RENAMED")) {
      const names = superseded.get(d.spec);
      if (names.some((n) => sameName(n, d.rename.to))) names.push(d.rename.from);
    }
  }

  for (const spec of specs) {
    const gone = superseded.get(spec.id) ?? [];
    const live = spec.requirements.filter((r) => !gone.some((n) => sameName(n, r.name)));
    for (const e of entriesOf(spec.id, spec.file, live, "spec")) if (!enforced.has(e.id)) enforced.set(e.id, e);
    // Superseded scenarios are still valid tag targets.
    entriesOf(spec.id, spec.file, spec.requirements.filter((r) => !live.includes(r)), "spec");
  }

  for (const change of changes) {
    const bySpec = new Map();
    for (const d of change.deltas.filter((d) => LIVE_OPS.has(d.operation))) {
      bySpec.set(d.spec, [...(bySpec.get(d.spec) ?? []), d.requirement]);
    }
    for (const [spec, reqs] of bySpec) {
      const file = join(change.dir, "specs", spec, "spec.md");
      for (const e of entriesOf(spec, file, reqs, change.name)) {
        if (change.complete) enforced.set(e.id, e);
        else if (!enforced.has(e.id) && !pending.has(e.id)) pending.set(e.id, e);
      }
    }
  }

  return { enforced, pending, known, duplicates };
}

/** Find `@spec <id>` tags in the repo's test files via `git grep` (tracked and untracked, not ignored). */
export async function sourceTags(root, testGlobs) {
  const include = testGlobs?.length ? testGlobs.map((g) => (g.startsWith(":") ? g : `:(glob)${g}`)) : ["."];
  const pathspecs = [...include, ":(exclude)openspec", ":(exclude,glob)**/*.md"];
  let stdout = "";
  try {
    ({ stdout } = await run(
      "git",
      ["grep", "-z", "-n", "-I", "--untracked", "-E", "@spec[[:space:]]+[^[:space:]]*#", "--", ...pathspecs],
      { cwd: root, maxBuffer: 64 << 20 },
    ));
  } catch (e) {
    if (e.code !== 1) throw new Error(`git grep failed (is ${root} inside a git repository?): ${e.stderr?.trim() || e.message}`);
  }
  const tags = new Map();
  for (const line of stdout.split("\n")) {
    const [file, lineNo, text] = line.split("\0");
    if (text === undefined) continue;
    for (const id of extractTags(text)) {
      tags.set(id, [...(tags.get(id) ?? []), { file, line: +lineNo }]);
    }
  }
  return tags;
}

export async function checkScenarios(project, { config, baseline, junit }) {
  const { root } = project;
  const { enforced, pending, known, duplicates } = inventory(project);
  const tags = await sourceTags(root, config.tests);
  const manual = config.manual ?? {};
  const baselined = new Set(baseline.unproven ?? []);
  const findings = [];
  const unproven = [];
  const at = (e) => ({ file: e.file, line: findLine(root, e.file, `Scenario: ${e.scenario}`) });

  const status = (id) => {
    const r = junit?.get(id);
    if (r?.failed) return { kind: "failing", detail: r.tests.join(", ") };
    if (manual[id]) return { kind: "proven" };
    if (junit) {
      if (r?.passed) return { kind: "proven" };
      if (r?.skipped) return { kind: "unproven", detail: "its tagged tests were skipped" };
      if (tags.has(id)) return { kind: "unproven", detail: "tagged in source, but no passing test in the JUnit report" };
      return { kind: "unproven" };
    }
    return { kind: tags.has(id) ? "proven" : "unproven" };
  };

  for (const d of duplicates) {
    findings.push({
      level: "error",
      message: `Scenarios "${d.names[0]}" and "${d.names[1]}" share the ID ${d.id}; rename one so each can be proven separately`,
      file: d.file,
      line: findLine(root, d.file, `Scenario: ${d.names[1]}`),
    });
  }

  for (const [id, e] of enforced) {
    const s = status(id);
    if (s.kind === "failing") {
      findings.push({ level: "error", message: `Scenario ${id} has failing tests: ${s.detail}`, ...at(e) });
    } else if (s.kind === "unproven") {
      unproven.push(id);
      if (baselined.has(id)) continue;
      const why = s.detail ? ` (${s.detail})` : "";
      const from = e.source === "spec" ? "" : ` [change ${e.source}, all tasks checked]`;
      findings.push({
        level: "error",
        message: `Scenario ${id} is not proven by a test${why}${from}. Tag a test with \`@spec ${id}\`, or list it under "manual" in openspec/plus.json with a reason`,
        ...at(e),
      });
    }
  }

  for (const [id, locations] of tags) {
    if (known.has(id)) continue;
    const near = [...known].filter((k) => k.split("#")[0] === id.split("#")[0]);
    const hint = near.length ? ` Scenarios in that spec: ${near.map((k) => k.split("#")[1]).join(", ")}` : "";
    for (const loc of locations) {
      findings.push({ level: "error", message: `Test tag @spec ${id} matches no scenario (renamed or removed?).${hint}`, ...loc });
    }
  }
  for (const id of junit?.keys() ?? []) {
    if (!known.has(id)) findings.push({ level: "warning", message: `JUnit report tags unknown scenario ${id}` });
  }

  for (const id of baselined) {
    if (!known.has(id)) findings.push({ level: "warning", message: `Baseline lists ${id}, which no longer exists; remove it from openspec/plus-baseline.json` });
    else if (enforced.has(id) && status(id).kind === "proven") {
      findings.push({ level: "warning", message: `Baseline lists ${id}, which is now proven; remove it from openspec/plus-baseline.json` });
    }
  }
  for (const id of Object.keys(manual)) {
    if (!known.has(id)) findings.push({ level: "warning", message: `openspec/plus.json marks unknown scenario ${id} as manual` });
    else if (!String(manual[id]).trim()) findings.push({ level: "error", message: `openspec/plus.json marks ${id} as manual without a reason` });
  }

  const pendingByChange = new Map();
  for (const [id, e] of pending) {
    if (status(id).kind !== "proven") pendingByChange.set(e.source, (pendingByChange.get(e.source) ?? 0) + 1);
  }
  for (const [change, n] of pendingByChange) {
    findings.push({ level: "info", message: `Change ${change}: ${n} scenario(s) not yet proven; enforced once all its tasks are checked` });
  }

  return { findings, unproven: unproven.sort(), counts: { enforced: enforced.size, pending: pending.size } };
}
