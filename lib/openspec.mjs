// Load specs and in-flight changes through the official CLI's JSON output, so
// parsing stays identical to what `openspec validate` and `archive` use.
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);
const CONCURRENCY = 8;

async function openspecJson(cwd, args) {
  try {
    const { stdout } = await run("openspec", [...args, "--json"], {
      cwd,
      maxBuffer: 64 << 20,
      env: { ...process.env, NO_COLOR: "1" },
    });
    return JSON.parse(stdout);
  } catch (e) {
    if (e.code === "ENOENT") throw new Error("openspec CLI not found on PATH (npm install -g @fission-ai/openspec)");
    let detail = e.stderr?.trim() || e.message;
    try {
      detail = JSON.parse(e.stdout).status.map((s) => s.message).join("; ");
    } catch {}
    throw new Error(`openspec ${args.join(" ")}: ${detail}`);
  }
}

async function mapPool(items, fn) {
  const out = new Array(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, items.length) }, worker));
  return out;
}

/**
 * @returns {Promise<{
 *   root: string,
 *   specs: {id: string, file: string, requirements: {name: string, scenarios: {name: string}[]}[]}[],
 *   changes: {name: string, dir: string, complete: boolean, completedTasks: number, totalTasks: number,
 *             error?: string, deltas: {spec: string, operation: string, requirement?: object, rename?: {from: string, to: string}}[]}[]
 * }>}
 */
export async function loadProject(cwd) {
  const [specList, changeList] = await Promise.all([
    openspecJson(cwd, ["list", "--specs"]),
    openspecJson(cwd, ["list"]),
  ]);
  const root = specList.root?.path ?? cwd;

  const specs = await mapPool(specList.specs, async ({ id }) => {
    const doc = await openspecJson(root, ["show", id, "--type", "spec"]);
    return { id, file: join("openspec/specs", id, "spec.md"), requirements: doc.requirements ?? [] };
  });

  const changes = await mapPool(changeList.changes, async (c) => {
    const change = {
      name: c.name,
      dir: join("openspec/changes", c.name),
      completedTasks: c.completedTasks,
      totalTasks: c.totalTasks,
      complete: c.totalTasks > 0 && c.completedTasks === c.totalTasks,
      deltas: [],
    };
    try {
      change.deltas = (await openspecJson(root, ["show", c.name, "--type", "change"])).deltas ?? [];
    } catch (e) {
      change.error = e.message;
    }
    return change;
  });

  return { root, specs, changes };
}

// Small cached line lookup so findings can point at file:line.
const fileCache = new Map();
export function findLine(root, file, needle) {
  const path = join(root, file);
  if (!fileCache.has(path)) fileCache.set(path, existsSync(path) ? readFileSync(path, "utf8").split("\n") : []);
  const i = fileCache.get(path).findIndex((l) => l.includes(needle));
  return i < 0 ? undefined : i + 1;
}
