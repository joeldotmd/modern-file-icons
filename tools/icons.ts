import Ajv from "ajv";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import type { IconMetadata } from "./icon-metadata.generated.ts";
import { validateSvg } from "./svg.ts";

type Category = IconMetadata["category"];

type CatalogIcon = IconMetadata & { svg: string };
type Action = "validate" | "generate" | "check";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const categories: Record<string, Category> = {
  folders: "folder",
  files: "file",
  symbols: "symbol",
};

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function collectPaths(root: string, pattern: string): Promise<string[]> {
  const paths: string[] = [];
  for await (const path of new Bun.Glob(pattern).scan({ cwd: root, onlyFiles: true })) {
    paths.push(path.replaceAll("\\", "/"));
  }
  return paths.sort();
}

/**
 * Validate canonical artwork under `base`: `icons/` (public) or `held/icons/` (rights-held
 * artwork kept out of public publication). Only `icons/` must be non-empty.
 */
export async function validateIcons(root = projectRoot, base = "icons"): Promise<CatalogIcon[]> {
  const schemaPath = join(root, "schemas", "icon.schema.json");
  const schema: object = JSON.parse(await readFile(schemaPath, "utf8")) as object;
  const validate = new Ajv({ allErrors: true, strict: true }).compile<IconMetadata>(schema);

  const errors: string[] = [];
  const ids = new Map<string, string>();
  const variants = new Map<string, CatalogIcon[]>();
  const icons: CatalogIcon[] = [];
  const metadataPaths = await collectPaths(root, base + "/**/*.json");
  const svgPaths = await collectPaths(root, base + "/**/*.svg");
  const pairedSvgs = new Set<string>();

  if (metadataPaths.length === 0 && base === "icons") {
    errors.push("No icon metadata found under icons/.");
  }

  for (const metadataPath of metadataPaths) {
    let data: unknown;
    try {
      data = JSON.parse(await readFile(join(root, metadataPath), "utf8")) as unknown;
    } catch (error) {
      errors.push(metadataPath + ": invalid JSON (" + String(error) + ")");
      continue;
    }

    if (!validate(data)) {
      for (const error of validate.errors ?? []) {
        errors.push(
          metadataPath + (error.instancePath || "/") + ": " + (error.message ?? "invalid value"),
        );
      }
      continue;
    }

    const match = new RegExp("^" + base + "/(folders|files|symbols)/[^/]+\\.json$").exec(
      metadataPath,
    );
    if (!match || data.category !== categories[match[1] ?? ""]) {
      errors.push(metadataPath + ": category must match its " + base + "/<category>/ directory.");
    }

    const originalPath = ids.get(data.id);
    if (originalPath) {
      errors.push(
        metadataPath + ': duplicate id "' + data.id + '" (also in ' + originalPath + ").",
      );
    } else {
      ids.set(data.id, metadataPath);
    }

    const svg = metadataPath.replace(/\.json$/, ".svg");
    pairedSvgs.add(svg);
    if (!(await isFile(join(root, svg)))) {
      errors.push(metadataPath + ": missing sibling SVG " + svg + ".");
    } else {
      try {
        const content = await readFile(join(root, svg), "utf8");
        validateSvg(content);
        // Imported artwork records its hash; a mismatch means the SVG was edited by hand.
        const recorded = data.origin?.sha256;
        if (recorded && createHash("sha256").update(content).digest("hex") !== recorded) {
          errors.push(
            svg +
              ": differs from the imported artwork (origin.sha256); re-import instead of editing.",
          );
        }
      } catch (error) {
        errors.push(svg + ": " + (error instanceof Error ? error.message : String(error)));
      }
    }

    for (const source of data.sources) {
      if (data.category !== "symbol" && source.library === "simple-icons") {
        errors.push(
          metadataPath +
            ": Simple Icons artwork may only be used as standalone symbols, not file/folder composites.",
        );
      }
      if (!(await isFile(join(root, source.license)))) {
        errors.push(metadataPath + ": missing license notice " + source.license + ".");
      }
    }

    const icon: CatalogIcon = { ...data, svg };
    icons.push(icon);
    if (data.variantGroup) {
      const group = variants.get(data.variantGroup) ?? [];
      group.push(icon);
      variants.set(data.variantGroup, group);
    }
  }

  for (const svg of svgPaths) {
    if (!pairedSvgs.has(svg)) {
      errors.push(svg + ": missing sibling metadata JSON.");
    }
  }

  for (const [name, members] of variants) {
    if (members.length < 2) {
      errors.push('variantGroup "' + name + '" needs at least two related icons.');
    }
    if (new Set(members.map((member) => member.category)).size !== 1) {
      errors.push('variantGroup "' + name + '" mixes icon categories.');
    }
  }

  if (errors.length > 0) {
    throw new Error("Icon metadata validation failed:\n" + errors.map((e) => "- " + e).join("\n"));
  }

  return icons.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export async function run(action: Action, root = projectRoot): Promise<void> {
  const icons = await validateIcons(root);
  if (action === "validate") {
    console.log("Validated " + icons.length + " icons.");
    return;
  }

  const catalogPath = join(root, "icons.json");
  // Written exactly as Prettier formats it, so the catalog and format checks agree.
  const generated = await format(JSON.stringify({ icons }), {
    ...(await resolveConfig(catalogPath)),
    parser: "json",
  });
  const exists = await isFile(catalogPath);
  const current = exists ? await readFile(catalogPath, "utf8") : null;

  if (action === "check") {
    if (current !== generated) {
      throw new Error("icons.json is missing or stale. Run bun run icons:generate.");
    }
    console.log("Catalog is current (" + icons.length + " icons).");
    return;
  }

  if (current !== generated) {
    await writeFile(catalogPath, generated, "utf8");
  }
  console.log("Generated icons.json (" + icons.length + " icons).");
}

if (import.meta.main) {
  const action: string | undefined = process.argv[2];
  if (action !== "validate" && action !== "generate" && action !== "check") {
    console.error("Usage: bun tools/icons.ts <validate|generate|check>");
    process.exitCode = 1;
  } else {
    try {
      await run(action);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
