#!/usr/bin/env node
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { checkConcerns } from "../lib/concerns.mjs";
import { readJunit } from "../lib/junit.mjs";
import { loadProject } from "../lib/openspec.mjs";
import { printFindings } from "../lib/report.mjs";
import { checkScenarios, inventory } from "../lib/scenarios.mjs";

const USAGE = `Usage:
  openspec-plus check [scenarios|concerns] [options]
      Fail when a scenario in force has no test proving it, or an in-flight
      change's Operational Concerns / tasks break the openspec-plus rules.
      --junit <file|dir>   only passing tests in these JUnit XML reports count as
                           proof (repeatable; a directory means every *.xml in it)
      --update-baseline    record today's gaps in openspec/plus-baseline.json and
                           exit 0 (adoption; afterwards only new gaps fail)
      --json               print findings as JSON
  openspec-plus ids [<spec-or-change>]
      List scenario IDs to use in \`@spec <id>\` test tags and tasks.md.

Common options:
  --root <dir>   project directory (default: current directory)

Config (optional) openspec/plus.json:
  { "tests": ["src/**/*.test.ts"],            git globs searched for @spec tags
    "manual": { "<id>": "how it is verified" } scenarios proven outside automated tests }`;

const readJson = (path, fallback) => (existsSync(path) ? JSON.parse(readFileSync(path, "utf8")) : fallback);

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: {
      root: { type: "string", default: "." },
      junit: { type: "string", multiple: true },
      "update-baseline": { type: "boolean" },
      json: { type: "boolean" },
      help: { type: "boolean", short: "h" },
    },
  });
  const [command, sub] = positionals;
  if (values.help || !command) {
    console.log(USAGE);
    return 0;
  }

  const project = await loadProject(resolve(values.root));
  const configPath = join(project.root, "openspec/plus.json");
  const baselinePath = join(project.root, "openspec/plus-baseline.json");

  if (command === "ids") {
    const { enforced, pending } = inventory(project);
    const rows = [...enforced.values(), ...pending.values()].filter(
      (e) => !sub || e.spec === sub || e.source === sub || e.spec.startsWith(`${sub}/`),
    );
    for (const e of rows) {
      const where = e.source === "spec" ? "" : `  [${pending.has(e.id) ? "pending" : "complete"} change ${e.source}]`;
      console.log(`${e.id}\t${e.requirement} › ${e.scenario}${where}`);
    }
    return 0;
  }

  if (command !== "check" || (sub && !["scenarios", "concerns"].includes(sub))) {
    console.error(USAGE);
    return 2;
  }

  const config = readJson(configPath, {});
  const update = values["update-baseline"];
  const baseline = update ? {} : readJson(baselinePath, {});
  const junit = values.junit ? readJunit(values.junit.map((p) => resolve(p))) : null;
  const sections = [];
  const next = readJson(baselinePath, {});

  if (sub !== "concerns") {
    const r = await checkScenarios(project, { config, baseline, junit });
    next.unproven = r.unproven;
    sections.push({
      name: "scenarios",
      findings: r.findings,
      summary: `${r.counts.enforced} in force, ${r.counts.pending} pending in incomplete changes${junit ? ", proof from JUnit" : ""}`,
    });
  }
  if (sub !== "scenarios") {
    const r = checkConcerns(project, { baseline });
    next.concerns = r.failing;
    sections.push({ name: "concerns", findings: r.findings, summary: `${project.changes.length} change(s) in flight` });
  }

  if (update) {
    writeFileSync(baselinePath, `${JSON.stringify(next, null, 2)}\n`);
    console.log(
      `Wrote ${baselinePath}: ${next.unproven?.length ?? 0} unproven scenario(s), ${next.concerns?.length ?? 0} change(s) exempt from the concerns lint.`,
    );
    return 0;
  }

  const all = printFindings(sections, { json: values.json });
  return all.some((f) => f.level === "error") ? 1 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`openspec-plus: ${e.message}`);
    process.exit(2);
  },
);
