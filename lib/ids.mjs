// Scenario IDs: `<spec-path>#<scenario-slug>`, e.g. `auth/login#auth-service-timeout`.
// Derived from the spec path and the scenario name, so nothing extra is written
// into the spec. Renaming a scenario changes its ID, which makes the old test
// tag an orphan: that is intended, the link is re-checked rather than kept blindly.

export const slug = (s) =>
  s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

export const scenarioId = (spec, scenarioName) => `${spec}#${slug(scenarioName)}`;

// Matches a bare ID anywhere in text (task lines, JUnit properties).
const ID = String.raw`[A-Za-z0-9][\w.-]*(?:/[\w.-]+)*#[a-z0-9]+(?:-[a-z0-9]+)*`;
export const idPattern = () => new RegExp(ID, "g");

// Matches `@spec <id>` in test source or test names; group 1 is the ID.
export const tagPattern = () => new RegExp(String.raw`@spec\s+(${ID})`, "g");

export const extractTags = (text) => [...text.matchAll(tagPattern())].map((m) => m[1]);
export const extractIds = (text) => [...text.matchAll(idPattern())].map((m) => m[0]);

// OpenSpec compares requirement headers whitespace- and case-insensitively.
export const sameName = (a, b) =>
  a.trim().replace(/\s+/g, " ").toLowerCase() === b.trim().replace(/\s+/g, " ").toLowerCase();
