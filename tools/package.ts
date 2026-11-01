import { createHash } from "node:crypto";
import { chmod, cp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { ReleaseManifest } from "./release-manifest.generated.ts";
import { isRecord } from "./selector.ts";
import { validateSvg } from "./svg.ts";
import {
  buildTheme,
  checkReleaseManifest,
  listedLicenses,
  releaseNotices,
  sha256,
} from "./theme.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Package and extension name for a theme: its id, unchanged. */
export function packageNameOf(themeId: string): string {
  return themeId;
}

/** The root package.json `repository`, shared by every distributed package. */
export async function repositoryOf(root = projectRoot): Promise<Record<string, unknown>> {
  const pkg: unknown = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
  if (!isRecord(pkg) || !isRecord(pkg.repository)) {
    throw new Error("package.json needs a repository entry");
  }
  return pkg.repository;
}

export type ReleaseSummary = {
  version: string;
  icons: number;
  decisions: number;
  fallbacks: number;
  files: number;
};

/** package.json for a release; name and version come from the built manifest. */
export function releasePackageJson(
  manifest: ReleaseManifest,
  repository: Record<string, unknown>,
): Record<string, unknown> {
  return {
    name: packageNameOf(manifest.modernFileIcons.theme),
    version: manifest.modernFileIcons.version,
    description:
      manifest.modernFileIcons.name +
      " file and folder icon theme: a VS Code-compatible icon theme manifest with fixed-colour SVGs.",
    license: "SEE LICENSE IN THIRD-PARTY-NOTICES.md",
    repository,
    exports: {
      "./manifest.json": "./manifest.json",
      "./icons/*": "./icons/*",
      "./package.json": "./package.json",
    },
    sideEffects: false,
  };
}

/**
 * Check a release package given as package-relative paths and contents. Every file must be the
 * package.json, the manifest, a notice, an SVG the manifest references or a licence text
 * NOTICE.md lists; the manifest must match its schema and every icon reference must resolve.
 */
export async function checkRelease(
  files: Map<string, Uint8Array>,
  root = projectRoot,
): Promise<ReleaseSummary> {
  const text = (path: string) => {
    const bytes = files.get(path);
    return bytes ? new TextDecoder().decode(bytes) : undefined;
  };
  const errors: string[] = [];
  for (const path of files.keys()) {
    const segments = path.split("/");
    if (
      path.startsWith("/") ||
      path.includes("\\") ||
      segments.some((segment) => !segment || segment === "." || segment === "..")
    ) {
      errors.push("unsafe path " + path);
    }
  }

  const manifestText = text("manifest.json");
  const packageText = text("package.json");
  if (!manifestText || !packageText) {
    throw new Error(["missing manifest.json or package.json", ...errors].join("\n"));
  }
  const manifest = await checkReleaseManifest(JSON.parse(manifestText), root);
  const meta = manifest.modernFileIcons;
  const pkg: unknown = JSON.parse(packageText);
  if (meta.profile !== "release") errors.push("manifest is a " + meta.profile + " build");
  if (!isRecord(pkg) || pkg.name !== packageNameOf(meta.theme)) {
    errors.push("package name must be " + packageNameOf(meta.theme));
  }
  if (!isRecord(pkg) || pkg.version !== meta.version) {
    errors.push("package version must match manifest version " + meta.version);
  }

  const expected = new Set<string>([
    "package.json",
    "manifest.json",
    "NOTICE.md",
    ...releaseNotices,
  ]);
  const definitions = manifest.iconDefinitions;
  for (const [id, { iconPath }] of Object.entries(definitions)) {
    // The schema limits iconPath to ./icons/<flat name>.svg.
    const path = iconPath.slice(2);
    expected.add(path);
    const svg = text(path);
    if (svg === undefined) {
      errors.push(id + ": missing " + path);
      continue;
    }
    try {
      validateSvg(svg);
    } catch (error) {
      errors.push(id + ": " + (error instanceof Error ? error.message : String(error)));
    }
  }

  const reference = (label: string, id: string) => {
    if (!definitions[id]) errors.push(label + " -> undefined icon " + id);
  };
  for (const [prefix, section] of [
    ["", manifest],
    ["light.", manifest.light],
  ] as const) {
    for (const [key, value] of Object.entries(section)) {
      if (key === "iconDefinitions" || key === "light" || key === "modernFileIcons") continue;
      if (typeof value === "string") reference(prefix + key, value);
      else if (isRecord(value)) {
        for (const [name, id] of Object.entries(value)) {
          reference(prefix + key + "[" + name + "]", String(id));
        }
      }
    }
  }
  for (const id of Object.keys(meta.fixedSizes)) reference("modernFileIcons.fixedSizes", id);

  const notice = text("NOTICE.md") ?? "";
  if (!notice.includes("(release build)")) errors.push("NOTICE.md is not a release build notice");
  for (const license of listedLicenses(notice)) expected.add(license);
  for (const path of expected) if (!files.has(path)) errors.push("missing " + path);
  for (const path of files.keys()) if (!expected.has(path)) errors.push("unexpected file " + path);

  if (errors.length) throw new Error("release package check failed:\n- " + errors.join("\n- "));
  return {
    version: meta.version,
    icons: Object.keys(definitions).length,
    decisions: meta.decisions,
    fallbacks: meta.fallbacks,
    files: files.size,
  };
}

/** Read a packed tarball (npm layout, entries under package/) into package-relative paths. */
export async function readTarball(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const entries = await new Bun.Archive(bytes).files();
  const files = new Map<string, Uint8Array>();
  for (const [path, file] of entries) {
    // Unprefixed entries keep their full path so checkRelease reports them as unexpected.
    files.set(path.startsWith("package/") ? path.slice(8) : path, await file.bytes());
  }
  return files;
}

export function digests(bytes: Uint8Array): { sha256: string; integrity: string } {
  return {
    sha256: sha256(bytes),
    integrity: "sha512-" + createHash("sha512").update(bytes).digest("base64"),
  };
}

/**
 * Pack a staged package directory with `bun pm pack`. It fixes timestamps but records each
 * file's mode, so modes are normalized first and the bytes don't depend on the local umask.
 */
export async function packStage(stage: string, out: string): Promise<string> {
  await chmod(stage, 0o755);
  for (const entry of await readdir(stage, { recursive: true, withFileTypes: true })) {
    await chmod(join(entry.parentPath, entry.name), entry.isDirectory() ? 0o755 : 0o644);
  }
  const packed = Bun.spawnSync(
    ["bun", "pm", "pack", "--ignore-scripts", "--quiet", "--destination", out],
    { cwd: stage, stdout: "pipe", stderr: "pipe" },
  );
  if (packed.exitCode !== 0) throw new Error("bun pm pack failed: " + packed.stderr.toString());
  return join(out, basename(packed.stdout.toString().trim()));
}

/** Build the theme from source, stage the release profile as a package, pack and check it. */
export async function packRelease(
  root = projectRoot,
  out = join(root, "dist", "modern-file-icons", "package"),
): Promise<{ tarball: string; summary: ReleaseSummary; sha256: string; integrity: string }> {
  const themeOut = join(root, "dist", "modern-file-icons");
  await buildTheme(root, themeOut);
  const release = join(themeOut, "release");
  const manifest = await checkReleaseManifest(
    JSON.parse(await readFile(join(release, "manifest.json"), "utf8")),
    root,
  );

  await rm(out, { recursive: true, force: true });
  const stage = join(out, packageNameOf(manifest.modernFileIcons.theme));
  await cp(release, stage, { recursive: true });
  await writeFile(
    join(stage, "package.json"),
    JSON.stringify(releasePackageJson(manifest, await repositoryOf(root)), null, 2) + "\n",
  );

  const tarball = await packStage(stage, out);
  const bytes = await readFile(tarball);
  const summary = await checkRelease(await readTarball(bytes), root);
  const result = digests(bytes);
  await writeFile(tarball + ".sha256", result.sha256 + "  " + basename(tarball) + "\n");
  return { tarball, summary, ...result };
}

/** Check a tarball and, when present beside it, its .sha256 record. */
export async function checkTarball(
  tarball: string,
  root = projectRoot,
): Promise<{ summary: ReleaseSummary; sha256: string; integrity: string }> {
  const bytes = await readFile(tarball);
  const summary = await checkRelease(await readTarball(bytes), root);
  const result = digests(bytes);
  const record = await readFile(tarball + ".sha256", "utf8").catch(() => null);
  if (record !== null && record.split(/\s+/)[0] !== result.sha256) {
    throw new Error(basename(tarball) + " does not match its .sha256 record");
  }
  return { summary, ...result };
}

if (import.meta.main) {
  const [action, target] = process.argv.slice(2);
  try {
    const result =
      action === "pack"
        ? await packRelease(projectRoot, target ? resolve(target) : undefined)
        : action === "check" && target
          ? { tarball: resolve(target), ...(await checkTarball(resolve(target))) }
          : null;
    if (!result) {
      console.error("Usage: bun tools/package.ts <pack [out-dir] | check <tarball>>");
      process.exitCode = 1;
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
