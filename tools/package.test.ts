import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRelease, packageNameOf, packStage, releasePackageJson } from "./package.ts";
import type { ReleaseManifest } from "./release-manifest.generated.ts";

// Protects the release-package gate in package.ts: a package must only ship safe, referenced
// release artwork with its notices, and pack to the same bytes on any machine.
const svg =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="-8 -8 40 40"><path d="M0 0h24v24H0z"/></svg>';
const encode = (value: string) => new TextEncoder().encode(value);
const repository = { type: "git", url: "https://example.com/icons.git" };
let work: string;

beforeAll(async () => {
  work = await mkdtemp(join(tmpdir(), "mfi-package-"));
});

afterAll(async () => {
  await rm(work, { recursive: true, force: true });
});

function manifest(overrides: Partial<ReleaseManifest> = {}): ReleaseManifest {
  return {
    iconDefinitions: {
      file: { iconPath: "./icons/file.svg" },
      folder: { iconPath: "./icons/folder.svg" },
    },
    file: "file",
    folder: "folder",
    folderExpanded: "folder",
    rootFolder: "folder",
    rootFolderExpanded: "folder",
    fileNames: { "readme.md": "file" },
    fileExtensions: {},
    languageIds: {},
    folderNames: { src: "folder" },
    folderNamesExpanded: { src: "folder" },
    light: { fileExtensions: { md: "file" } },
    modernFileIcons: {
      theme: "modern-file-icons",
      name: "Modern File Icons",
      version: "1.2.3",
      profile: "release",
      bleed: 1 / 3,
      bleedUnits: 8,
      fixedSizes: { file: 24 },
      source: {},
      decisions: 2,
      fallbacks: 0,
    },
    ...overrides,
  };
}

function release(edit: (files: Map<string, string>) => void = () => {}): Map<string, Uint8Array> {
  const theme = manifest();
  const files = new Map<string, string>([
    ["manifest.json", JSON.stringify(theme)],
    ["package.json", JSON.stringify(releasePackageJson(theme, repository))],
    ["icons/file.svg", svg],
    ["icons/folder.svg", svg],
    ["LICENSE", "MIT"],
    ["THIRD-PARTY-NOTICES.md", "notices"],
    [
      "NOTICE.md",
      "# Modern File Icons — notices (release build)\n\n## Licence texts\n\n- `licenses/lucide-isc.md`\n\n## Artwork\n",
    ],
    ["licenses/lucide-isc.md", "ISC"],
  ]);
  edit(files);
  return new Map([...files].map(([path, value]) => [path, encode(value)]));
}

test("accepts a complete release package named after its theme", async () => {
  expect(packageNameOf("modern-file-icons")).toBe("modern-file-icons");
  expect(releasePackageJson(manifest(), repository)).toMatchObject({
    name: "modern-file-icons",
    version: "1.2.3",
    repository,
  });
  expect(await checkRelease(release())).toEqual({
    version: "1.2.3",
    icons: 2,
    decisions: 2,
    fallbacks: 0,
    files: 8,
  });
});

test.each<[string, (files: Map<string, string>) => void, string]>([
  ["path traversal", (f) => f.set("icons/../escape.svg", svg), "unsafe path"],
  ["absolute paths", (f) => f.set("/etc/passwd", "x"), "unsafe path"],
  ["preview or selector files", (f) => f.set("preview/index.html", "<html>"), "unexpected file"],
  ["unreferenced artwork", (f) => f.set("icons/held.svg", svg), "unexpected file icons/held.svg"],
  ["missing artwork", (f) => f.delete("icons/folder.svg"), "missing icons/folder.svg"],
  [
    "unsafe SVGs",
    (f) => f.set("icons/file.svg", svg.replace("<path", "<script>x</script><path")),
    "disallowed SVG element script",
  ],
  [
    "icon paths outside icons/",
    (f) =>
      f.set(
        "manifest.json",
        JSON.stringify(
          manifest({
            iconDefinitions: {
              file: { iconPath: "../file.svg" },
              folder: { iconPath: "./icons/folder.svg" },
            },
          }),
        ),
      ),
    "does not match the release manifest schema",
  ],
  [
    "mappings to undefined icons",
    (f) => f.set("manifest.json", JSON.stringify(manifest({ light: { fileNames: { a: "x" } } }))),
    "light.fileNames[a] -> undefined icon x",
  ],
  ["missing notices", (f) => f.delete("THIRD-PARTY-NOTICES.md"), "missing THIRD-PARTY-NOTICES.md"],
  [
    "missing licence texts",
    (f) => f.delete("licenses/lucide-isc.md"),
    "missing licenses/lucide-isc.md",
  ],
  [
    "unlisted licence texts",
    (f) => f.set("licenses/extra.md", "x"),
    "unexpected file licenses/extra.md",
  ],
  [
    "preview builds",
    (f) => f.set("NOTICE.md", "# Modern File Icons — notices (preview build)\n"),
    "not a release build notice",
  ],
  [
    "names not derived from the theme",
    (f) => f.set("package.json", JSON.stringify({ name: "other", version: "1.2.3" })),
    "package name must be modern-file-icons",
  ],
  [
    "version drift",
    (f) => f.set("package.json", JSON.stringify({ name: "modern-file-icons", version: "9.9.9" })),
    "package version must match manifest version 1.2.3",
  ],
])("rejects %s", async (_case, edit, message) => {
  await expect(checkRelease(release(edit))).rejects.toThrow(message);
});

test("packs the same bytes whatever the files' modes", async () => {
  const pack = async (name: string, fileMode: number, directoryMode: number) => {
    const stage = join(work, name, "stage");
    await mkdir(join(stage, "icons"), { recursive: true });
    await writeFile(
      join(stage, "package.json"),
      JSON.stringify({ name: "probe", version: "1.0.0" }),
    );
    await writeFile(join(stage, "icons", "a.svg"), svg);
    await chmod(join(stage, "icons", "a.svg"), fileMode);
    await chmod(join(stage, "icons"), directoryMode);
    return readFile(await packStage(stage, join(work, name)));
  };
  const groupWritable = await pack("group-writable", 0o664, 0o775);
  const private_ = await pack("private", 0o600, 0o700);
  expect(Buffer.compare(groupWritable, private_)).toBe(0);
});
