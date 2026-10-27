#!/usr/bin/env node
// Post-process the OpenSpec skills/commands that sync.sh copied into
// ~/.claude, keeping upstream text and adding only openspec-plus behavior:
//   1. agents/openspec-verifier.md: a fresh-context, read-only verifier built
//      from the upstream verify skill (so it tracks upgrades) + our preamble.
//   2. /opsx:verify and the verify skill: delegate to that subagent.
//   3. archive and sync skills/commands: the `openspec-plus check` gate appended.
// Usage: install-claude.mjs <claude-dir>
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const claudeDir = process.argv[2];
if (!claudeDir) throw new Error("usage: install-claude.mjs <claude-dir>");
const overlay = join(dirname(fileURLToPath(import.meta.url)), "..", "overlay", "claude");
const read = (path) => {
  if (!existsSync(path)) throw new Error(`${path} not found (upstream OpenSpec layout changed?)`);
  return readFileSync(path, "utf8");
};
// Let the generated skill/command use the extra tools our additions need.
const allowTools = (frontmatter, tools) =>
  frontmatter.replace(/^allowed-tools:(.*)$/m, (line, list) => {
    const missing = tools.filter((t) => !list.includes(t));
    return missing.length ? `allowed-tools:${list.trimEnd()}, ${missing.join(", ")}` : line;
  });
const splitFrontmatter = (text) => {
  const m = text.match(/^---\n[\s\S]*?\n---\n/);
  if (!m) throw new Error("expected YAML frontmatter in generated OpenSpec file");
  return [m[0], text.slice(m[0].length)];
};

const verifySkill = join(claudeDir, "skills/openspec-verify-change/SKILL.md");
const verifyCommand = join(claudeDir, "commands/opsx/verify.md");
const WORKFLOWS = '\'["propose","explore","apply","update","sync","archive","verify"]\'';
for (const [file, workflow] of [[verifySkill, "verify"], [join(claudeDir, "commands/opsx/archive.md"), "archive"], [join(claudeDir, "commands/opsx/sync.md"), "sync"]]) {
  if (!existsSync(file)) {
    throw new Error(
      `the "${workflow}" workflow was not generated; enable it in the global OpenSpec profile (install.sh does this):\n` +
        `  openspec config set profile custom && openspec config set workflows ${WORKFLOWS}`,
    );
  }
}
const [, upstreamProcedure] = splitFrontmatter(read(verifySkill));

const agent = `---
name: openspec-verifier
description: Independent, read-only verifier for an OpenSpec change. Use to check an implementation against its proposal, specs, design and tasks before archive, without the implementer's context.
tools: Read, Grep, Glob, Bash
---

${read(join(overlay, "verifier-preamble.md"))}${upstreamProcedure.trimStart()}`;
mkdirSync(join(claudeDir, "agents"), { recursive: true });
writeFileSync(join(claudeDir, "agents/openspec-verifier.md"), agent);

const delegate = read(join(overlay, "verify-delegate.md"));
for (const file of [verifySkill, verifyCommand]) {
  const [frontmatter] = splitFrontmatter(read(file));
  writeFileSync(file, `${allowTools(frontmatter, ["Agent"])}\n${delegate}`);
}

const gate = read(join(overlay, "archive-gate.md"));
for (const rel of [
  "skills/openspec-archive-change/SKILL.md",
  "commands/opsx/archive.md",
  "skills/openspec-sync-specs/SKILL.md",
  "commands/opsx/sync.md",
]) {
  const file = join(claudeDir, rel);
  const [frontmatter, body] = splitFrontmatter(read(file));
  writeFileSync(file, `${allowTools(frontmatter, ["Bash(openspec-plus:*)"])}${body.trimEnd()}\n${gate}`);
}

console.log(`openspec-plus: verifier subagent + archive/sync gate installed into ${claudeDir}`);
