import { afterEach, beforeEach, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { run, validateIcons } from "./icons.ts";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mfi-icons-"));
  await cp(join(sourceRoot, "icons"), join(root, "icons"), { recursive: true });
  await cp(join(sourceRoot, "licenses"), join(root, "licenses"), { recursive: true });
  await mkdir(join(root, "schemas"));
  await cp(
    join(sourceRoot, "schemas", "icon.schema.json"),
    join(root, "schemas", "icon.schema.json"),
  );
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

async function editMetadata(
  path: string,
  change: (metadata: Record<string, unknown>) => void,
): Promise<void> {
  const fullPath = join(root, path);
  const metadata = JSON.parse(await readFile(fullPath, "utf8")) as Record<string, unknown>;
  change(metadata);
  await writeFile(fullPath, JSON.stringify(metadata, null, 2) + "\n");
}

test("validates all discovered icons without assuming the library's size", async () => {
  const icons = await validateIcons(root);
  const svgPaths = [...new Bun.Glob("icons/**/*.svg").scanSync({ cwd: root, onlyFiles: true })];
  expect(icons).toHaveLength(svgPaths.length);
  expect(svgPaths.length).toBeGreaterThan(0);
  expect(icons.map((icon) => icon.id)).toEqual([...icons.map((icon) => icon.id)].sort());
  expect(icons.find((icon) => icon.id === "file-react")?.sources.map((s) => s.icon)).toEqual([
    "FileCogIcon",
    "ReactIcon",
  ]);
  expect(icons.find((icon) => icon.id === "folder-link")?.svg).toBe(
    "icons/folders/folder-link.svg",
  );
});

test("accepts an additional standalone icon without changing validation or tests", async () => {
  await mkdir(join(root, "icons", "symbols"), { recursive: true });
  await writeFile(
    join(root, "icons", "symbols", "sample-symbol.svg"),
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>',
  );
  await writeFile(
    join(root, "icons", "symbols", "sample-symbol.json"),
    JSON.stringify({
      id: "sample-symbol",
      name: "Sample Symbol",
      category: "symbol",
      style: "filled",
      sources: [],
      customization: { color: true, strokeWidth: false },
    }),
  );
  const icons = await validateIcons(root);
  expect(icons.find((icon) => icon.id === "sample-symbol")?.category).toBe("symbol");
  await run("generate", root);
  const catalog = JSON.parse(await readFile(join(root, "icons.json"), "utf8")) as {
    icons: { id: string }[];
  };
  expect(catalog.icons).toHaveLength(icons.length);
});

test("generates a deterministic catalog and identifies stale output", async () => {
  await run("generate", root);
  const first = await readFile(join(root, "icons.json"), "utf8");
  await run("check", root);
  await run("generate", root);
  expect(await readFile(join(root, "icons.json"), "utf8")).toBe(first);
  await writeFile(join(root, "icons.json"), '{"icons":[]}\n');
  await expect(run("check", root)).rejects.toThrow("missing or stale");
});

test("rejects invalid JSON Schema fields", async () => {
  await editMetadata("icons/folders/folder-star.json", (metadata) => {
    metadata.id = "Invalid ID";
  });
  await expect(validateIcons(root)).rejects.toThrow("must match pattern");
});

test("rejects duplicate stable IDs", async () => {
  await editMetadata("icons/folders/folder-star.json", (metadata) => {
    metadata.id = "folder-link";
  });
  await expect(validateIcons(root)).rejects.toThrow('duplicate id "folder-link"');
});

test("rejects missing license notices", async () => {
  await unlink(join(root, "licenses", "lucide-isc.md"));
  await expect(validateIcons(root)).rejects.toThrow(
    "missing license notice licenses/lucide-isc.md",
  );
});

test("rejects Simple Icons brand marks in folder or file composites", async () => {
  await editMetadata("icons/folders/folder-star.json", (metadata) => {
    const sources = metadata.sources as Array<Record<string, unknown>>;
    sources.push({
      library: "simple-icons",
      icon: "GitHub",
      version: "16.34.0",
      license: "licenses/simple-icons-cc0.md",
    });
  });
  await writeFile(join(root, "licenses", "simple-icons-cc0.md"), "# Fixture license\n");
  await expect(validateIcons(root)).rejects.toThrow(
    "Simple Icons artwork may only be used as standalone symbols",
  );
});

test("rejects SVGs without metadata and metadata without an SVG", async () => {
  await writeFile(join(root, "icons", "folders", "orphan.svg"), "<svg/>");
  await unlink(join(root, "icons", "files", "file-js-01.svg"));
  await expect(validateIcons(root)).rejects.toThrow("missing sibling metadata JSON");
  await expect(validateIcons(root)).rejects.toThrow("missing sibling SVG");
});

test("rejects incomplete variant groups", async () => {
  await editMetadata("icons/files/file-md-02.json", (metadata) => {
    delete metadata.variantGroup;
  });
  await expect(validateIcons(root)).rejects.toThrow(
    'variantGroup "file-markdown" needs at least two related icons',
  );
});

test("rejects malformed or unsafe SVGs before catalog generation", async () => {
  const svg = join(root, "icons", "folders", "folder-star.svg");
  await writeFile(svg, "THIS IS NOT SVG");
  await expect(run("generate", root)).rejects.toThrow("missing root element");

  await writeFile(
    svg,
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><script>alert(1)</script></svg>',
  );
  await expect(validateIcons(root)).rejects.toThrow("disallowed SVG element script");
});
