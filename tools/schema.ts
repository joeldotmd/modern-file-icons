import { compile } from "json-schema-to-typescript";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Each JSON Schema is the authority for its TypeScript types; outputs are never edited by hand.
const targets = [
  { output: "icon-metadata.generated.ts", schemas: ["icon.schema.json"] },
  {
    output: "theme.generated.ts",
    schemas: ["theme.schema.json", "associations.schema.json", "rights.schema.json"],
  },
  { output: "release-manifest.generated.ts", schemas: ["release-manifest.schema.json"] },
];

async function generatedTypes(root: string, schemas: string[], output: string): Promise<string> {
  const sources: string[] = [];
  for (const file of schemas) {
    const schema = JSON.parse(await readFile(join(root, "schemas", file), "utf8")) as Parameters<
      typeof compile
    >[0];
    sources.push(
      await compile(schema, file, { bannerComment: "", cwd: join(root, "schemas"), format: false }),
    );
  }
  const banner =
    "// Generated from " +
    schemas.map((file) => "schemas/" + file).join(", ") +
    ". Do not edit by hand.\n\n";
  return format(banner + sources.join("\n"), {
    ...(await resolveConfig(output)),
    parser: "typescript",
  });
}

export async function checkSchemaTypes(
  action: "check" | "generate",
  root = projectRoot,
): Promise<void> {
  for (const target of targets) {
    const output = join(root, "tools", target.output);
    const expected = await generatedTypes(root, target.schemas, output);
    const existing = await readFile(output, "utf8").catch((error: unknown) => {
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return null;
      throw error;
    });
    if (action === "check" && existing !== expected) {
      throw new Error(target.output + " is missing or stale. Run bun run schema:generate.");
    }
    if (action === "generate" && existing !== expected) {
      await writeFile(output, expected);
    }
  }
}

if (import.meta.main) {
  const action = process.argv[2];
  if (action !== "check" && action !== "generate") {
    console.error("Usage: bun tools/schema.ts <check|generate>");
    process.exitCode = 1;
  } else {
    try {
      await checkSchemaTypes(action);
      console.log(action === "check" ? "Schema types are current." : "Schema types generated.");
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
