import { afterAll, beforeAll, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readReviewRecords } from "./import-selector.ts";
import {
  bleedBox,
  buildProfile,
  derivedSvg,
  framedSvg,
  loadTheme,
  resolveDecision,
} from "./theme.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
let out: string;

beforeAll(async () => {
  out = await mkdtemp(join(tmpdir(), "mfi-theme-"));
});

afterAll(async () => {
  await rm(out, { recursive: true, force: true });
});

test("the theme keeps every approved selection exactly as reviewed", async () => {
  const { theme } = await loadTheme(root);
  const records = await readReviewRecords(root);
  expect(Object.keys(theme.decisions).sort()).toEqual(Object.keys(records.decisions).sort());
  for (const [id, record] of Object.entries(records.decisions)) {
    const decision = theme.decisions[id];
    expect(decision?.selection).toEqual({
      icon: record.primary.icon,
      expandedIcon: record.primary.expandedIcon,
    });
    expect(decision?.visualApproved).toBe(record.primary.visualApproved === true);
    expect(decision?.kind).toBe(record.kind);
  }
});

test("unreproducible selections fall back to the generic icon with a recorded reason", async () => {
  const loaded = await loadTheme(root);
  for (const [id, decision] of Object.entries(loaded.theme.decisions)) {
    if (decision.artwork) continue;
    expect(decision.unavailable).toBeTruthy();
    const resolution = resolveDecision(loaded, id, "preview");
    expect(resolution.use).toBe(
      decision.kind === "file" ? loaded.theme.fallbacks.file : loaded.theme.fallbacks.folder,
    );
    expect(resolution.fallback).toBe(decision.unavailable);
  }
});

test("release builds contain only eligible artwork and previews keep every reproduced selection", async () => {
  const loaded = await loadTheme(root);
  const preview = await buildProfile(loaded, root, join(out, "preview"), "preview");
  const release = await buildProfile(loaded, root, join(out, "release"), "release", preview.bleed);
  for (const outcome of preview.outcomes) {
    expect(Boolean(outcome.fallback)).toBe(!loaded.theme.decisions[outcome.id]?.artwork);
  }
  for (const outcome of release.outcomes) {
    const decision = loaded.theme.decisions[outcome.use];
    for (const artwork of [decision?.artwork, decision?.expandedArtwork]) {
      if (artwork) expect(loaded.icons.get(artwork)?.release?.status).toBe("eligible");
    }
  }
  for (const size of [18, 24]) {
    const box = bleedBox(size, preview.bleed);
    expect(Number.isInteger(box.image) && Number.isInteger(box.offset)).toBe(true);
  }
  for (const profile of ["preview", "release"]) {
    const manifest = JSON.parse(await readFile(join(out, profile, "manifest.json"), "utf8")) as {
      iconDefinitions: Record<string, { iconPath: string }>;
      fileExtensions: Record<string, string>;
      folderNamesExpanded: Record<string, string>;
      file: string;
      folder: string;
      modernFileIcons: { bleed: number; fixedSizes: Record<string, number> };
    };
    expect(manifest.modernFileIcons.bleed).toBe(preview.bleed);
    if (profile === "preview") {
      for (const [id, decision] of Object.entries(loaded.theme.decisions)) {
        if (decision.fixedSize === undefined) continue;
        expect(manifest.modernFileIcons.fixedSizes[id.slice(id.indexOf(":") + 1)]).toBe(
          decision.fixedSize,
        );
      }
    }
    for (const name of [
      manifest.file,
      manifest.folder,
      ...Object.values(manifest.fileExtensions),
      ...Object.values(manifest.folderNamesExpanded),
    ]) {
      expect(manifest.iconDefinitions[name]).toBeDefined();
    }
    for (const { iconPath } of Object.values(manifest.iconDefinitions)) {
      expect((await stat(join(out, profile, iconPath))).isFile()).toBe(true);
    }
    const notice = await readFile(join(out, profile, "NOTICE.md"), "utf8");
    expect(notice).toContain("## Credits");
    expect(notice).toContain("## Licence texts");
    expect(notice).not.toContain("re-weighted and recoloured");
  }
}, 120_000);

test("outputs apply the decision's colour and stroke, then pad the frame by the bleed", () => {
  const canonical =
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M2 2h20"/></svg>';
  const decision = {
    kind: "file" as const,
    selection: { icon: "lucide:Minus", expandedIcon: null },
    color: { light: "#242424", dark: "#F0F0F0" },
    stroke: { scope: "all" as const, scale: 0.75 },
    visualApproved: true,
  };
  const svg = derivedSvg(canonical, decision, "light");
  expect(svg).toContain('stroke-width="1.5"');
  expect(svg).toContain('color="#242424"');
  expect(framedSvg(svg, 1 / 3)).toContain('viewBox="-8 -8 40 40"');
  // A root colour of currentColor inherits from the host, so it takes the decision colour too;
  // an explicit root colour is the artwork's own and stays.
  const inheriting = canonical.replace("<svg ", '<svg color="currentColor" ');
  expect(derivedSvg(inheriting, decision, "dark")).toContain('color="#F0F0F0"');
  const own = canonical.replace("<svg ", '<svg color="#123456" ');
  expect(derivedSvg(own, decision, "dark")).toContain('color="#123456"');
});
