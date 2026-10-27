// Same-PR rule: code and the OpenSpec change it implements land together.
// - Code + a change folder this PR touches but leaves unarchived -> error.
// - Code + no OpenSpec change/spec at all -> error, unless the PR body has
//   `No-Spec: <reason>` (hotfix, refactor, dependency bump, ...).
// Proposal-only PRs (no code) always pass.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { promisify } from "node:util";

const run = promisify(execFile);
const MIN_REASON_WORDS = 3;

async function git(root, args) {
  try {
    return (await run("git", args, { cwd: root, maxBuffer: 64 << 20 })).stdout;
  } catch (e) {
    throw new Error(`git ${args.join(" ")}: ${e.stderr?.trim() || e.message}`);
  }
}

async function changedFiles(root, base, pathspecs = []) {
  let from = base;
  try {
    from = (await run("git", ["merge-base", base, "HEAD"], { cwd: root })).stdout.trim();
  } catch {
    // Shallow CI checkout of a PR merge commit: base..HEAD is exactly the PR.
  }
  const out = await git(root, ["diff", "--name-only", "--relative", "--no-renames", from, "HEAD", "--", ...pathspecs]);
  return out.split("\n").filter(Boolean);
}

/** PR body from --pr-body-file, or the GitHub Actions pull_request event. */
export function readPrBody(file) {
  if (file) return readFileSync(file, "utf8");
  const event = process.env.GITHUB_EVENT_PATH;
  if (event && existsSync(event)) return JSON.parse(readFileSync(event, "utf8")).pull_request?.body ?? "";
  return null;
}

export async function checkPr(project, { base, body, config }) {
  const { root } = project;
  const findings = [];
  const all = await changedFiles(root, base);
  const nonCode = (config.nonCode ?? []).map((g) => (g.startsWith(":") ? g : `:(exclude,glob)${g}`));
  const code = await changedFiles(root, base, [".", ":(exclude)openspec", ":(exclude,glob)**/*.md", ...nonCode]);

  const inFlight = new Set(project.changes.map((c) => c.name));
  const touched = new Set();
  let specWork = false;
  for (const f of all) {
    const m = f.match(/^openspec\/changes\/([^/]+)\//);
    if (m && m[1] !== "archive") touched.add(m[1]);
    if (/^openspec\/(specs|changes)\//.test(f)) specWork = true;
  }
  const summary = `${all.length} file(s) changed vs ${base}, ${code.length} code`;
  if (!code.length) return { findings, summary };

  for (const name of touched) {
    if (!inFlight.has(name)) continue;
    findings.push({
      level: "error",
      message: `Change ${name} is edited in this PR alongside code but not archived. Archive it in this PR (\`/opsx:archive ${name}\`), or move the code to the PR that archives it`,
      file: `openspec/changes/${name}/proposal.md`,
    });
  }

  if (!specWork) {
    const noSpec = body?.match(/^\s*No-Spec:\s*(.*)$/im);
    const reason = noSpec?.[1].trim() ?? "";
    if (!noSpec) {
      findings.push({
        level: "error",
        message: `Code changed (${code.slice(0, 3).join(", ")}${code.length > 3 ? ", ..." : ""}) with no OpenSpec change or spec update. Add or archive a change, or add a \`No-Spec: <reason>\` line to the PR description${body === null ? " (pass --pr-body-file outside GitHub Actions)" : ""}`,
      });
    } else if (reason.split(/\s+/).filter(Boolean).length < MIN_REASON_WORDS) {
      findings.push({ level: "error", message: `No-Spec needs a reason of at least ${MIN_REASON_WORDS} words (got "${reason}")` });
    } else {
      findings.push({ level: "info", message: `No-Spec: ${reason}` });
    }
  }
  return { findings, summary };
}
