import { readFile, readdir } from "node:fs/promises";

const componentsDirectory = new URL("../components/", import.meta.url);
const retiredClasses = [
  "icon-button",
  "mini-action",
  "numeric-field",
  "panel-section",
  "presentation-control-row",
  "presentation-format-grid",
  "presentation-mode-segmented",
  "presentation-number-field",
  "presentation-section",
  "presentation-select",
  "section-title",
  "select-input",
  "text-button",
];

async function listTsxFiles(directoryUrl) {
  const entries = await readdir(directoryUrl, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const entryUrl = new URL(`${entry.name}${entry.isDirectory() ? "/" : ""}`, directoryUrl);

    if (entry.isDirectory()) {
      files.push(...(await listTsxFiles(entryUrl)));
    } else if (entry.name.endsWith(".tsx")) {
      files.push(entryUrl);
    }
  }

  return files;
}

const violations = [];

for (const fileUrl of await listTsxFiles(componentsDirectory)) {
  const source = await readFile(fileUrl, "utf8");

  for (const className of retiredClasses) {
    if (source.includes(className)) {
      violations.push(`${fileUrl.pathname}: retired class \"${className}\"`);
    }
  }
}

if (violations.length > 0) {
  console.error("Design System guard failed:\n");
  console.error(violations.join("\n"));
  process.exitCode = 1;
} else {
  console.log("Design System guard passed.");
}
