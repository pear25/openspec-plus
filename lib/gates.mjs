// Build gates: commands from openspec/plus.json that prove scenarios, for hard
// rules a unit test does not express well (lint rules, bundle size, perf
// budgets, dependency audits). A passing exit proves every ID in `proves`.
import { spawn } from "node:child_process";

const DEFAULT_TIMEOUT_S = 600;
const TAIL_LINES = 15;

function runGate(root, gate) {
  return new Promise((resolve) => {
    const child = spawn("sh", ["-c", gate.run], { cwd: root, env: process.env });
    let output = "";
    const keep = (chunk) => {
      output = (output + chunk).slice(-16384);
    };
    child.stdout.on("data", keep);
    child.stderr.on("data", keep);
    const timer = setTimeout(() => {
      keep(`\n[openspec-plus] timed out after ${gate.timeoutSeconds ?? DEFAULT_TIMEOUT_S}s`);
      child.kill("SIGKILL");
    }, (gate.timeoutSeconds ?? DEFAULT_TIMEOUT_S) * 1000);
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, tail: output.trimEnd().split("\n").slice(-TAIL_LINES).join("\n") });
    });
  });
}

/**
 * Run gates sequentially (they may share build output).
 * @returns {Promise<{byId: Map<string, {gate: string, ok: boolean, skipped?: boolean, tail?: string}>, findings: object[]}>}
 */
export async function runGates(root, gates = [], { skip = false } = {}) {
  const byId = new Map();
  const findings = [];
  for (const [i, gate] of gates.entries()) {
    const name = gate.name ?? `gates[${i}]`;
    if (typeof gate.run !== "string" || !Array.isArray(gate.proves) || !gate.proves.length) {
      findings.push({ level: "error", message: `openspec/plus.json gate "${name}" needs "run" (a command) and "proves" (scenario IDs)` });
      continue;
    }
    const result = skip ? { ok: true, skipped: true } : await runGate(root, gate);
    if (!skip && !result.ok) {
      findings.push({ level: "error", message: `Gate "${name}" failed (\`${gate.run}\`):\n${result.tail}` });
    }
    for (const id of gate.proves) {
      // A scenario proven by several gates fails if any of them fails.
      if (byId.get(id)?.ok === false) continue;
      byId.set(id, { gate: name, ...result });
    }
  }
  if (skip && byId.size) {
    findings.push({ level: "warning", message: `--no-gates: ${byId.size} scenario(s) counted as proven by gates that did not run` });
  }
  return { byId, findings };
}
