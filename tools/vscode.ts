import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReleaseManifest } from "./release-manifest.generated.ts";
import { checkRelease, digests, packageNameOf, readTarball, repositoryOf } from "./package.ts";
import { checkReleaseManifest, loadTheme } from "./theme.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Placeholder Marketplace/Open VSX namespace for local packaging; not a registered publisher.
export const publisher = "joeldotmd";

/** Static icon-theme extension manifest: no activation code, no contributed commands. */
export function extensionPackageJson(
  manifest: ReleaseManifest,
  repository: Record<string, unknown>,
): Record<string, unknown> {
  return {
    name: packageNameOf(manifest.modernFileIcons.theme),
    displayName: manifest.modernFileIcons.name,
    description: "A curated file and folder icon theme.",
    version: manifest.modernFileIcons.version,
    publisher,
    license: "SEE LICENSE IN THIRD-PARTY-NOTICES.md",
    repository,
    engines: { vscode: "^1.75.0" },
    categories: ["Themes"],
    contributes: {
      iconThemes: [
        {
          id: manifest.modernFileIcons.theme,
          label: manifest.modernFileIcons.name,
          path: "./manifest.json",
        },
      ],
    },
  };
}

// vsce requires a README; it becomes the extension's description page.
function extensionReadme(manifest: ReleaseManifest): string {
  const scale = Math.round(100 / (1 + 2 * manifest.modernFileIcons.bleed));
  return [
    "# " + manifest.modernFileIcons.name,
    "",
    "A curated file and folder icon theme. Select **" +
      manifest.modernFileIcons.name +
      "** under _Preferences: File Icon Theme_.",
    "",
    "Each SVG has transparent padding (`modernFileIcons.bleed` in `manifest.json`) so artwork that extends past the icon edge isn't cut off. VS Code can't draw that padding outside the icon box, so the icons appear at about " +
      scale +
      "% of the usual size.",
    "",
    "Licences: see `LICENSE`, `THIRD-PARTY-NOTICES.md`, `NOTICE.md` and `licenses/`.",
    "",
  ].join("\n");
}

/**
 * Build a VSIX from a checked release tarball, using its manifest and SVGs unchanged. vsce
 * stamps the entries it generates with the current time, so rebuilds match in content only.
 */
export async function packExtension(
  tarball: string,
  out = join(projectRoot, "dist", "modern-file-icons", "vscode"),
  root = projectRoot,
): Promise<{ vsix: string; sha256: string; files: number }> {
  const files = await readTarball(await readFile(tarball));
  await checkRelease(files, root);
  const manifest = await checkReleaseManifest(
    JSON.parse(new TextDecoder().decode(files.get("manifest.json"))),
    root,
  );

  await rm(out, { recursive: true, force: true });
  const stage = join(out, "extension");
  const staged = new Map(files);
  const extension = extensionPackageJson(manifest, await repositoryOf(root));
  staged.set("package.json", new TextEncoder().encode(JSON.stringify(extension, null, 2) + "\n"));
  staged.set("README.md", new TextEncoder().encode(extensionReadme(manifest)));
  for (const [path, bytes] of staged) {
    const target = join(stage, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
  }

  const vsix = join(
    out,
    packageNameOf(manifest.modernFileIcons.theme) +
      "-" +
      manifest.modernFileIcons.version +
      ".vsix",
  );
  const vsce = join(root, "node_modules", ".bin", "vsce");
  // vsce must package exactly the staged release files: nothing dropped, nothing added.
  const listed = Bun.spawnSync([vsce, "ls", "--no-dependencies"], { cwd: stage, stdout: "pipe" });
  const listedFiles = listed.stdout.toString().split("\n").filter(Boolean).sort();
  const expected = [...staged.keys()].sort();
  if (listed.exitCode !== 0 || listedFiles.join("\n") !== expected.join("\n")) {
    throw new Error("vsce would not package exactly the staged release files");
  }
  const packed = Bun.spawnSync([vsce, "package", "--no-dependencies", "--out", vsix], {
    cwd: stage,
    stdout: "pipe",
    stderr: "pipe",
  });
  if (packed.exitCode !== 0) {
    throw new Error("vsce package failed: " + packed.stderr.toString() + packed.stdout.toString());
  }
  const { sha256 } = digests(await readFile(vsix));
  await writeFile(vsix + ".sha256", sha256 + "  " + basename(vsix) + "\n");
  return { vsix, sha256, files: staged.size };
}

if (import.meta.main) {
  const [given, out] = process.argv.slice(2);
  try {
    // Default to the tarball `bun run theme:package` writes for the current theme.
    const { theme } = await loadTheme(projectRoot);
    const tarball = resolve(
      given ??
        join(
          projectRoot,
          "dist",
          "modern-file-icons",
          "package",
          packageNameOf(theme.id) + "-" + theme.version + ".tgz",
        ),
    );
    const result = await packExtension(tarball, out ? resolve(out) : undefined);
    console.log(JSON.stringify(result, null, 2));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
