const ICON = { error: "✖", warning: "⚠", info: "·" };
const ORDER = { error: 0, warning: 1, info: 2 };

// https://docs.github.com/actions/using-workflows/workflow-commands-for-github-actions
const ghEscape = (s, prop) => {
  const out = String(s).replace(/%/g, "%25").replace(/\r/g, "%0D").replace(/\n/g, "%0A");
  return prop ? out.replace(/:/g, "%3A").replace(/,/g, "%2C") : out;
};

export function printFindings(sections, { json = false } = {}) {
  const all = sections.flatMap(({ name, findings }) => findings.map((f) => ({ check: name, ...f })));
  if (json) {
    console.log(JSON.stringify(all, null, 2));
    return all;
  }
  for (const { name, findings, summary } of sections) {
    console.log(`\n${name}: ${summary}`);
    for (const f of [...findings].sort((a, b) => ORDER[a.level] - ORDER[b.level])) {
      const loc = f.file ? `${f.file}${f.line ? `:${f.line}` : ""}  ` : "";
      console.log(`  ${ICON[f.level]} ${loc}${f.message}`);
    }
  }
  if (process.env.GITHUB_ACTIONS === "true") {
    for (const f of all.filter((f) => f.level !== "info")) {
      const props = [f.file && `file=${ghEscape(f.file, true)}`, f.line && `line=${f.line}`, `title=${ghEscape(`openspec-plus ${f.check}`, true)}`];
      console.log(`::${f.level} ${props.filter(Boolean).join(",")}::${ghEscape(f.message)}`);
    }
  }
  const errors = all.filter((f) => f.level === "error").length;
  const warnings = all.filter((f) => f.level === "warning").length;
  console.log(`\n${errors ? "FAIL" : "OK"}: ${errors} error(s), ${warnings} warning(s)`);
  return all;
}
