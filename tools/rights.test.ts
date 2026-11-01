import { afterEach, expect, test } from "bun:test";
import { cp, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { checkRights, loadRights, obligations, ownerNotice, registerRelease } from "./rights.ts";
import { loadTheme, resolveDecision } from "./theme.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scratch: string[] = [];

/** A scratch copy of the repository, optionally without held/ (a public-safe checkout). */
async function copy(options: { held: boolean }): Promise<string> {
  const work = await mkdtemp(join(tmpdir(), "mfi-rights-"));
  scratch.push(work);
  const skipped = options.held
    ? /^\/(?:node_modules|dist|\.git)(?:\/|$)/
    : /^\/(?:held|node_modules|dist|\.git)(?:\/|$)/;
  await cp(root, work, {
    recursive: true,
    filter: (path) => !skipped.test(path.slice(root.length)),
  });
  await symlink(join(root, "node_modules"), join(work, "node_modules"));
  return work;
}

afterEach(async () => {
  await Promise.all(scratch.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

test("the rights register gates each audited decision by its release approval", async () => {
  const { register, byArtwork } = await loadRights(root);
  const entries = Object.values(register.decisions);
  const counts = new Map<string, number>();
  for (const entry of entries)
    counts.set(entry.assessment, (counts.get(entry.assessment) ?? 0) + 1);
  expect(entries).toHaveLength(60);
  expect(Object.fromEntries(counts)).toEqual({ CONDITIONAL: 59, PERMITTED: 1 });
  expect(byArtwork.size).toBe(67);
  const approved = entries.filter((entry) => entry.approval);
  expect(approved).toHaveLength(60);
  for (const entry of entries) {
    const status = registerRelease(entry, register.audit.date).status;
    expect(status).toBe(entry.approval ? "eligible" : "held");
  }
});

test("audited licences are the artwork's own, not the icon pack's", async () => {
  const { register } = await loadRights(root);
  const licence = (id: string) => register.decisions[id]?.copyright.license;
  expect(licence("file:ruby")).toBe("CC-BY-SA-2.5");
  expect(licence("file:r")).toBe("CC-BY-SA-4.0");
  expect(licence("file:verdaccio")).toBe("CC-BY-4.0");
  expect(licence("file:css")).toBe("CC0-1.0");
  expect(register.decisions["file:android"]?.copyright.credit).toContain(
    "Creative Commons 3.0 Attribution",
  );
  expect(obligations("CC-BY-SA-4.0")).toEqual({ shareAlike: true, noDerivatives: false });
  expect(obligations("CC-BY-ND-4.0")).toEqual({ shareAlike: false, noDerivatives: true });
  const ruby = JSON.parse(
    await readFile(join(root, "icons/symbols/simple-icons-ruby.json"), "utf8"),
  );
  expect(ruby.sources[0].license).toBe("licenses/cc-by-sa-2-5.md");
  expect(ruby.rights.shareAlike).toBe(true);
});

test("an approval cannot clear permission-needed or unverified artwork", async () => {
  const work = await copy({ held: true });
  const path = join(work, "themes/modern-file-icons/rights.json");
  const register = JSON.parse(await readFile(path, "utf8"));
  register.decisions["file:go"].assessment = "PERMISSION-NEEDED";
  await writeFile(path, JSON.stringify(register));
  await expect(loadRights(work)).rejects.toThrow("cannot be approved");
});

test("held artwork placed under icons/ is caught", async () => {
  const work = await copy({ held: true });
  // Withdraw Zig's approval: its artwork in icons/ must then be held.
  const path = join(work, "themes/modern-file-icons/rights.json");
  const register = JSON.parse(await readFile(path, "utf8"));
  delete register.decisions["file:zig"].approval;
  register.decisions["file:zig"].unresolved = ["Withdrawn for the test."];
  await writeFile(path, JSON.stringify(register));
  await expect(checkRights(work)).rejects.toThrow("must live in held/");
});

test("a public-safe checkout validates and keeps approved decisions selected", async () => {
  const work = await copy({ held: false });
  await checkRights(work);
  const loaded = await loadTheme(work);
  expect(loaded.absent.size).toBe(0);
  expect(resolveDecision(loaded, "file:zig", "release").use).toBe("file:zig");
  expect(resolveDecision(loaded, "folder:folder-src", "release").use).toBe("folder:folder-src");
});

test("drift in the review record or hand-edited artwork is detected", async () => {
  const work = await copy({ held: true });
  const calibration = join(work, "themes/modern-file-icons/folder-calibration.json");
  await writeFile(calibration, (await readFile(calibration, "utf8")) + " ");
  await expect(loadTheme(work)).rejects.toThrow("changed since theme.json was imported");
  await cp(join(root, "themes/modern-file-icons/folder-calibration.json"), calibration);
  const svg = join(work, "icons/symbols/owner-zig.svg");
  await writeFile(svg, (await readFile(svg, "utf8")) + "\n");
  await expect(loadTheme(work)).rejects.toThrow("differs from the imported artwork");
});

test("an approval needs source and package forms the register allows", async () => {
  const { register } = await loadRights(root);
  const entry = structuredClone(register.decisions["file:coala"]);
  if (!entry) throw new Error("file:coala missing from the register");
  delete entry.approval;
  expect(registerRelease(entry, register.audit.date).status).toBe("held");
  entry.approval = { date: "2026-10-31" };
  const release = registerRelease(entry, register.audit.date);
  expect(release.status).toBe("eligible");
  expect(release.basis).toBe(
    "Approved for distribution in source and theme packages on 2026-10-31.",
  );
  const work = await copy({ held: true });
  const path = join(work, "themes/modern-file-icons/rights.json");
  const data = JSON.parse(await readFile(path, "utf8"));
  data.decisions["file:ruby"].forms.package = "PERMISSION-NEEDED";
  await writeFile(path, JSON.stringify(data));
  await expect(loadRights(work)).rejects.toThrow("while its package form is PERMISSION-NEEDED");
});

test("the register keeps no placeholder or stringified entries and states every trademark", async () => {
  const { register } = await loadRights(root);
  for (const [id, entry] of Object.entries(register.decisions)) {
    for (const item of [...entry.conditions, ...(entry.unresolved ?? [])]) {
      expect(item.startsWith("['") || item.startsWith("See priority evidence")).toBe(false);
    }
    expect(entry.trademark, id).toBeTruthy();
  }
});

test("public notices keep necessary terms without publishing internal review history", async () => {
  const { register } = await loadRights(root);
  const notice = ownerNotice(register);
  expect(notice).toContain("Credit:");
  expect(notice).toContain("Copyright:");
  expect(notice).toContain("Condition:");
  expect(notice).toContain("Policy:");
  expect(notice).not.toMatch(/approved in chat|release-confirmation-review|Nest projects|Route A/);
  expect(notice).not.toContain("- Release:");
  expect(notice).not.toContain("- Evidence:");
  const held = structuredClone(register);
  delete held.decisions["file:zig"]?.approval;
  expect(ownerNotice(held)).not.toContain("## file:zig ");
});

test("replaced decisions use generic or canonical artwork and leave the register", async () => {
  const { register } = await loadRights(root);
  const loaded = await loadTheme(root);
  for (const id of [
    "file:figma",
    "file:bruno",
    "file:python-misc",
    "file:tobi",
    "folder:folder-markdown",
  ]) {
    expect(register.decisions[id]).toBeUndefined();
    expect(resolveDecision(loaded, id, "release").use).toBe(id);
  }
  expect(loaded.theme.decisions["file:python-misc"]?.artwork).toBe("mdi-snake");
  expect(loaded.icons.get("mdi-snake")?.release?.status).toBe("eligible");
  // Tobi's standalone-icon form was never verified, so it uses generic artwork.
  expect(loaded.theme.decisions["file:tobi"]?.artwork).toBe("lucide-code-xml");
  expect(loaded.icons.has("material-tobi")).toBe(false);
});
