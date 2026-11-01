import { afterEach, beforeEach, expect, test } from "bun:test";
import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkSchemaTypes } from "./schema.ts";

const sourceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let root: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "mfi-schema-review-"));
  await mkdir(join(root, "tools"));
  await cp(join(sourceRoot, "schemas"), join(root, "schemas"), { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

test("generated TypeScript types stay synchronized with the JSON Schema", async () => {
  await checkSchemaTypes("generate", root);
  await checkSchemaTypes("check", root);

  const output = join(root, "tools", "icon-metadata.generated.ts");
  const generated = await readFile(output, "utf8");
  expect(generated).toContain("export interface IconMetadata");
  expect(generated).toContain("strokeWidth: boolean");

  const schemaPath = join(root, "schemas", "icon.schema.json");
  const schema = JSON.parse(await readFile(schemaPath, "utf8")) as {
    required: string[];
    properties: Record<string, unknown>;
  };
  schema.required.push("newField");
  schema.properties.newField = { type: "string" };
  await writeFile(schemaPath, JSON.stringify(schema));
  await expect(checkSchemaTypes("check", root)).rejects.toThrow("missing or stale");
});
