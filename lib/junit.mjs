// Minimal JUnit XML reader: which scenario IDs have passing / failing tests.
// A testcase proves the IDs tagged (`@spec <id>`) in its name or classname, or
// listed in a `<property name="spec" value="<id> ..."/>` (pytest record_property).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { extractIds, extractTags } from "./ids.mjs";

const ATTRS = String.raw`((?:\s+[\w:.-]+\s*=\s*(?:"[^"]*"|'[^']*'))*)`;
const TESTCASE = new RegExp(String.raw`<testcase${ATTRS}\s*(?:/>|>([\s\S]*?)</testcase>)`, "g");
const PROPERTY = new RegExp(String.raw`<property${ATTRS}\s*/?>`, "g");

const decode = (s) =>
  s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(+n))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, "&");

function attrs(src) {
  const out = {};
  for (const m of src.matchAll(/([\w:.-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g)) out[m[1]] = decode(m[2] ?? m[3]);
  return out;
}

function xmlFiles(path) {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { recursive: true })
    .filter((f) => f.endsWith(".xml"))
    .map((f) => join(path, f));
}

/** @returns {Map<string, {passed: number, failed: number, skipped: number, tests: string[]}>} */
export function readJunit(paths) {
  const results = new Map();
  for (const file of paths.flatMap(xmlFiles)) {
    const xml = readFileSync(file, "utf8");
    for (const [, attrSrc, body = ""] of xml.matchAll(TESTCASE)) {
      const { name = "", classname = "" } = attrs(attrSrc);
      const ids = new Set(extractTags(`${classname} ${name}`));
      for (const [, p] of body.matchAll(PROPERTY)) {
        const prop = attrs(p);
        if (prop.name === "spec" && prop.value) extractIds(prop.value).forEach((id) => ids.add(id));
      }
      if (!ids.size) continue;
      const outcome = /<(failure|error)\b/.test(body) ? "failed" : /<skipped\b/.test(body) ? "skipped" : "passed";
      for (const id of ids) {
        const r = results.get(id) ?? { passed: 0, failed: 0, skipped: 0, tests: [] };
        r[outcome]++;
        r.tests.push(`${classname ? `${classname} › ` : ""}${name}`);
        results.set(id, r);
      }
    }
  }
  return results;
}
