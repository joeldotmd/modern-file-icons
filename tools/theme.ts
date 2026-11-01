import { Resvg } from "@resvg/resvg-js";
import Ajv from "ajv";
import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { validateIcons } from "./icons.ts";
import { checkRights, heldIcons, loadRights, type Rights } from "./rights.ts";
import type { IconMetadata } from "./icon-metadata.generated.ts";
import { readReviewRecords, themeDirectory } from "./import-selector.ts";
import {
  formatStroke,
  hydrateCalibration,
  inheritsColor,
  modes,
  readSelector,
  selectorReference,
  type Mode,
} from "./selector.ts";
import {
  childElements,
  elementsOf,
  formatNumber,
  parseSvg,
  resolveStyles,
  rootOf,
  serializeSvg,
} from "./svg-normalize.ts";
import type { Element } from "@xmldom/xmldom";
import { validateSvg } from "./svg.ts";
import type { Decision, ThemeAssociations, ThemeDefinition } from "./theme.generated.ts";
import type { ReleaseManifest } from "./release-manifest.generated.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const profiles = ["preview", "release"] as const;
export type Profile = (typeof profiles)[number];
type Icon = IconMetadata & { svg: string };
type Theme = {
  theme: ThemeDefinition;
  associations: ThemeAssociations;
  icons: Map<string, Icon>;
  rights: Rights;
  // Audited artwork missing from this checkout (a public-safe checkout has no held/).
  absent: Set<string>;
};
type State = "closed" | "open";

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export function sha256(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function readJson(path: string): Promise<unknown> {
  return JSON.parse(await readFile(path, "utf8")) as unknown;
}

/** Validate theme.json and associations.json against their schemas and the artwork catalog. */
export async function loadTheme(root = projectRoot): Promise<Theme> {
  const ajv = new Ajv({ allErrors: true, strict: true });
  const validateTheme = ajv.compile<ThemeDefinition>(
    (await readJson(join(root, "schemas", "theme.schema.json"))) as object,
  );
  const validateAssociations = ajv.compile<ThemeAssociations>(
    (await readJson(join(root, "schemas", "associations.schema.json"))) as object,
  );
  const theme = await readJson(join(root, themeDirectory, "theme.json"));
  const associations = await readJson(join(root, themeDirectory, "associations.json"));
  const errors: string[] = [];
  if (!validateTheme(theme)) {
    for (const e of validateTheme.errors ?? []) {
      errors.push("theme.json" + e.instancePath + ": " + e.message);
    }
  }
  if (!validateAssociations(associations)) {
    for (const e of validateAssociations.errors ?? []) {
      errors.push("associations.json" + e.instancePath + ": " + e.message);
    }
  }
  if (errors.length) throw new Error("Theme validation failed:\n- " + errors.join("\n- "));
  const definition = theme as ThemeDefinition;
  const aliases = associations as ThemeAssociations;

  const icons = new Map<string, Icon>();
  for (const icon of await validateIcons(root)) icons.set(icon.id, icon);
  if (await exists(join(root, heldIcons))) {
    for (const icon of await validateIcons(root, heldIcons)) icons.set(icon.id, icon);
  }
  const rights = await loadRights(root);
  const absent = new Set<string>();

  // The review record must be the one theme.json was imported from.
  const reviewed: Array<[string, { path: string; sha256: string }]> = [
    ["selections", definition.source.selections],
    ["calibration", definition.source.calibration],
  ];
  for (const [label, file] of reviewed) {
    const actual = sha256(await readFile(join(root, file.path)).catch(() => ""));
    if (actual !== file.sha256) {
      errors.push(
        label + " (" + file.path + ") changed since theme.json was imported; re-run theme:import",
      );
    }
  }

  for (const [id, decision] of Object.entries(definition.decisions)) {
    if (!id.startsWith(decision.kind + ":")) errors.push(id + ": kind does not match its ID");
    if (!decision.artwork) {
      if (!decision.unavailable) errors.push(id + ": needs artwork or an unavailable reason");
      continue;
    }
    if (decision.unavailable) errors.push(id + ": has both artwork and an unavailable reason");
    for (const artwork of [decision.artwork, decision.expandedArtwork]) {
      if (!artwork || icons.has(artwork)) continue;
      if (rights.byArtwork.has(artwork)) absent.add(artwork);
      else errors.push(id + ": unknown artwork " + artwork);
    }
    if (decision.kind === "folder" && !decision.expandedArtwork) {
      errors.push(id + ": folder needs expanded artwork");
    }
    if (decision.stroke?.scope === "motif" && !absent.has(decision.artwork)) {
      const path = icons.get(decision.artwork)?.svg;
      const svg = path ? await readFile(join(root, path), "utf8") : "";
      if (!svg.includes('id="motif"'))
        errors.push(id + ": motif stroke on artwork without a motif");
    }
  }
  for (const [role, id] of Object.entries(definition.fallbacks)) {
    const decision = definition.decisions[id];
    const kind = role === "file" ? "file" : "folder";
    if (!decision || decision.kind !== kind || !decision.artwork || absent.has(decision.artwork)) {
      errors.push("fallback " + role + " must be a " + kind + " decision with artwork");
    }
  }
  for (const [group, map] of Object.entries(aliases)) {
    const kind = group === "folderNames" ? "folder" : "file";
    for (const [alias, id] of Object.entries(map as Record<string, string>)) {
      if (definition.decisions[id]?.kind !== kind) {
        errors.push(group + "." + alias + ": unknown " + kind + " decision " + id);
      }
    }
  }
  if (errors.length) throw new Error("Theme validation failed:\n- " + errors.join("\n- "));
  return { theme: definition, associations: aliases, icons, rights, absent };
}

export type Resolution = { use: string; fallback?: string };

/** Which decision's artwork renders for a decision in a profile, and why if it is a fallback. */
export function resolveDecision(loaded: Theme, id: string, profile: Profile): Resolution {
  const { theme, icons } = loaded;
  const decision = theme.decisions[id];
  if (!decision) throw new Error("unknown decision " + id);
  const generic = decision.kind === "file" ? theme.fallbacks.file : theme.fallbacks.folder;
  const blocked = (candidate: Decision): string | null => {
    if (!candidate.artwork) return candidate.unavailable ?? "no artwork";
    for (const artwork of [candidate.artwork, candidate.expandedArtwork]) {
      if (artwork && loaded.absent.has(artwork)) {
        return "held artwork " + artwork + " is not in this checkout (public-safe checkout)";
      }
    }
    if (profile === "release") {
      for (const artwork of [candidate.artwork, candidate.expandedArtwork]) {
        if (!artwork) continue;
        const release = icons.get(artwork)?.release;
        if (release?.status !== "eligible") {
          return "release held (" + artwork + "): " + (release?.basis ?? "no release record");
        }
      }
    }
    return null;
  };
  const reason = blocked(decision);
  if (reason === null) return { use: id };
  const fallback = theme.decisions[generic];
  if (!fallback || generic === id || blocked(fallback) !== null) {
    throw new Error("no safe " + profile + " fallback for " + id + " (" + reason + ")");
  }
  return { use: generic, fallback: reason };
}

/** Apply a decision's theme stroke and colour to canonical artwork for one host appearance. */
export function derivedSvg(canonical: string, decision: Decision, mode: Mode): string {
  const document = parseSvg(canonical);
  const root = rootOf(document);
  const stroke = decision.stroke;
  if (stroke) {
    const scope =
      stroke.scope === "all"
        ? root
        : elementsOf(root).find((element) => element.getAttribute("id") === "motif");
    if (!scope) throw new Error("motif stroke requires a motif element");
    for (const element of elementsOf(scope)) {
      const width = element.getAttribute("stroke-width");
      if (width !== null && Number.isFinite(Number(width))) {
        element.setAttribute("stroke-width", formatStroke(Number(width) * stroke.scale));
      }
    }
    if (stroke.motifWidth !== undefined && !scope.hasAttribute("stroke-width")) {
      scope.setAttribute("stroke-width", String(stroke.motifWidth));
    }
  }
  if (inheritsColor(root)) root.setAttribute("color", decision.color[mode]);
  const svg = serializeSvg(document);
  validateSvg(svg);
  return svg;
}

// The selector drew artwork in a square box with overflow visible, and many composites place
// their motif past the folder's edge. Outputs therefore use a square frame padded by a uniform
// bleed (a fraction of the icon size per side); hosts draw the image that much larger.
type Frame = { x: number; y: number; side: number };

function frameOf(svg: string): Frame {
  const root = rootOf(parseSvg(svg));
  const ratio = (root.getAttribute("preserveAspectRatio") ?? "xMidYMid meet").trim();
  if (ratio !== "xMidYMid meet" && ratio !== "xMidYMid") {
    throw new Error("root preserveAspectRatio " + ratio + " cannot be framed");
  }
  const [x = 0, y = 0, w = 0, h = 0] = (root.getAttribute("viewBox") ?? "")
    .split(/[\s,]+/)
    .map(Number);
  const side = Math.max(w, h);
  return { x: x + (w - side) / 2, y: y + (h - side) / 2, side };
}

export function framedSvg(svg: string, bleed: number): string {
  const frame = frameOf(svg);
  const document = parseSvg(svg);
  const root = rootOf(document);
  const pad = frame.side * bleed;
  const box = [frame.x - pad, frame.y - pad, frame.side + 2 * pad, frame.side + 2 * pad];
  root.setAttribute("viewBox", box.map(formatNumber).join(" "));
  return serializeSvg(document);
}

const resvgOptions = { font: { loadSystemFonts: false } };

function pixels(svg: string, size: number): Buffer {
  const document = parseSvg(svg);
  const root = rootOf(document);
  root.setAttribute("width", String(size));
  root.setAttribute("height", String(size));
  return Buffer.from(new Resvg(serializeSvg(document), resvgOptions).render().pixels);
}

const bleedStep = 4 / 24;

/** Image size and offset that make a framed icon cover exactly `size` pixels of layout. */
export function bleedBox(size: number, bleed: number): { image: number; offset: number } {
  // Round away floating-point noise so whole-pixel margins stay whole (18 px * 1/3 = 6 px).
  const pad = Math.round(size * bleed * 1e9) / 1e9;
  return { image: size + 2 * pad, offset: -pad };
}

/** How far visible ink extends beyond the square frame, as a fraction of the frame side. */
export function overflowOf(svg: string): number {
  const size = 192; // frame + 50% padding per side, so the frame spans 96 px
  const data = pixels(framedSvg(svg, 0.5), size);
  let overflow = 0;
  for (let i = 0; i < data.length; i += 4) {
    if ((data[i + 3] ?? 0) <= 32) continue;
    const x = (i / 4) % size;
    const y = Math.floor(i / 4 / size);
    const beyond = Math.max(48 - x, x + 1 - 144, 48 - y, y + 1 - 144);
    if (beyond > 0) overflow = Math.max(overflow, (beyond + 1) / 96);
  }
  return overflow;
}

function iconName(id: string, state: State): string {
  const name = id.slice(id.indexOf(":") + 1);
  return state === "open" ? name + "-open" : name;
}

export type BuildOutcome = {
  id: string;
  profile: Profile;
  use: string;
  fallback?: string;
  bleeds: boolean;
  files: Record<State, Partial<Record<Mode, string>>>;
};

/**
 * Build one profile as a VS Code-compatible file icon theme with fixed-colour SVGs. The bleed is
 * measured from the outputs unless given, so profiles built together can share one frame.
 */
export async function buildProfile(
  loaded: Theme,
  root: string,
  out: string,
  profile: Profile,
  givenBleed?: number,
): Promise<{ outcomes: BuildOutcome[]; bleed: number }> {
  const { theme, associations, icons } = loaded;
  const outcomes: BuildOutcome[] = [];
  const lightDecisions = new Set<string>();
  const usedArtwork = new Set<string>();
  const outputs = new Map<string, { svg: string; outcome: BuildOutcome }>();
  // Icons the selector drew at a fixed CSS pixel size, keyed by icon definition.
  const fixedSizes: Record<string, number> = {};

  for (const id of Object.keys(theme.decisions).sort()) {
    const resolution = resolveDecision(loaded, id, profile);
    const decision = theme.decisions[resolution.use];
    if (!decision?.artwork)
      throw new Error("resolved decision " + resolution.use + " has no artwork");
    const outcome: BuildOutcome = {
      id,
      profile,
      use: resolution.use,
      bleeds: false,
      files: { closed: {}, open: {} },
    };
    if (resolution.fallback) outcome.fallback = resolution.fallback;
    const states: State[] = decision.kind === "folder" ? ["closed", "open"] : ["closed"];
    const distinct = decision.color.light.toLowerCase() !== decision.color.dark.toLowerCase();
    if (distinct) lightDecisions.add(id);
    for (const state of states) {
      const artwork = state === "open" ? decision.expandedArtwork : decision.artwork;
      const icon = artwork ? icons.get(artwork) : undefined;
      if (!icon) throw new Error(id + ": missing artwork " + artwork);
      usedArtwork.add(icon.id);
      const canonical = await readFile(join(root, icon.svg), "utf8");
      for (const mode of distinct ? modes : (["dark"] as const)) {
        const name = iconName(id, state) + (mode === "light" ? "_light" : "");
        outputs.set(name, { svg: derivedSvg(canonical, decision, mode), outcome });
        if (decision.fixedSize !== undefined) fixedSizes[name] = decision.fixedSize;
        outcome.files[state][mode] = join(out, "icons", name + ".svg");
        if (!distinct) outcome.files[state].light = outcome.files[state].dark;
      }
    }
    outcomes.push(outcome);
  }

  let measured = 0;
  for (const { svg, outcome } of outputs.values()) {
    const overflow = overflowOf(svg);
    if (overflow > 0) outcome.bleeds = true;
    measured = Math.max(measured, overflow);
  }
  if (measured >= 0.5) throw new Error("artwork overflows its frame by half its size or more");
  // Bleed comes in steps of 4 of the 24 icon units, so its margin is a whole number of pixels
  // at 18 px and 24 px and the image is never resampled off the pixel grid.
  const bleed = givenBleed ?? Math.ceil(measured / bleedStep - 1e-9) * bleedStep;
  if (measured > bleed) throw new Error("profile overflow exceeds the shared bleed");
  for (const [name, size] of Object.entries(fixedSizes)) {
    if (!Number.isInteger(bleedBox(size, bleed).offset))
      throw new Error(name + ": fixed size gives a fractional bleed");
  }

  await rm(out, { recursive: true, force: true });
  await mkdir(join(out, "icons"), { recursive: true });
  const definitions: Record<string, { iconPath: string }> = {};
  for (const [name, { svg }] of [...outputs].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const framed = framedSvg(svg, bleed);
    validateSvg(framed);
    await writeFile(join(out, "icons", name + ".svg"), framed + "\n");
    definitions[name] = { iconPath: "./icons/" + name + ".svg" };
  }

  const mapped = (map: Record<string, string>, state: State, light: boolean) =>
    Object.fromEntries(
      Object.entries(map)
        .filter(([, id]) => !light || lightDecisions.has(id))
        .map(([alias, id]) => [alias, iconName(id, state) + (light ? "_light" : "")]),
    );
  const defaults = (light: boolean) => {
    const entries: Record<string, string> = {};
    const add = (key: string, id: string, state: State) => {
      if (!light || lightDecisions.has(id))
        entries[key] = iconName(id, state) + (light ? "_light" : "");
    };
    add("file", theme.fallbacks.file, "closed");
    add("folder", theme.fallbacks.folder, "closed");
    add("folderExpanded", theme.fallbacks.folder, "open");
    add("rootFolder", theme.fallbacks.rootFolder, "closed");
    add("rootFolderExpanded", theme.fallbacks.rootFolder, "open");
    return entries;
  };
  const section = (light: boolean) => ({
    ...defaults(light),
    fileNames: mapped(associations.fileNames, "closed", light),
    fileExtensions: mapped(associations.fileExtensions, "closed", light),
    languageIds: mapped(associations.languageIds, "closed", light),
    folderNames: mapped(associations.folderNames, "closed", light),
    folderNamesExpanded: mapped(associations.folderNames, "open", light),
  });
  const manifest = await checkReleaseManifest(
    {
      iconDefinitions: definitions,
      ...section(false),
      light: section(true),
      modernFileIcons: {
        theme: theme.id,
        name: theme.name,
        version: theme.version,
        profile,
        // Fraction of the icon size each image extends past its layout box on every side. Draw
        // the image at size * (1 + 2 * bleed) with a margin of -size * bleed; see bleedBox().
        bleed,
        // The same bleed in units of a 24-unit icon.
        bleedUnits: Math.round(bleed * 24 * 1e9) / 1e9,
        // Draw these icons at this many CSS pixels (plus the bleed) from the top-left of their box,
        // whatever the requested size, as the selector did.
        fixedSizes,
        source: theme.source,
        decisions: outcomes.length,
        fallbacks: outcomes.filter((outcome) => outcome.fallback).length,
      },
    },
    root,
  );
  await writeFile(join(out, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
  const artworks = [...usedArtwork].sort().map((id) => icons.get(id) as Icon);
  await writeNotices(root, out, artworks, profile);
  return { outcomes, bleed };
}

/** Validate a built manifest against schemas/release-manifest.schema.json. */
export async function checkReleaseManifest(
  value: unknown,
  root = projectRoot,
): Promise<ReleaseManifest> {
  const validate = new Ajv({ allErrors: true, strict: true }).compile<ReleaseManifest>(
    (await readJson(join(root, "schemas", "release-manifest.schema.json"))) as object,
  );
  if (!validate(value)) {
    const errors = (validate.errors ?? []).map((e) => (e.instancePath || "/") + ": " + e.message);
    throw new Error(
      "manifest.json does not match the release manifest schema:\n- " + errors.join("\n- "),
    );
  }
  return value;
}

/** Notice files every build ships beside its generated NOTICE.md. */
export const releaseNotices = ["LICENSE", "THIRD-PARTY-NOTICES.md"] as const;

/** The licence texts a NOTICE.md lists under "Licence texts", in the format writeNotices uses. */
export function listedLicenses(notice: string): string[] {
  const section = notice.split("\n## Licence texts\n")[1]?.split("\n## ")[0] ?? "";
  return [...section.matchAll(/^- `(licenses\/[^`]+)`$/gm)].map((match) => match[1] ?? "");
}

async function writeNotices(
  root: string,
  out: string,
  artworks: Icon[],
  profile: Profile,
): Promise<void> {
  const licenses = new Set(
    artworks.flatMap((icon) => [
      ...icon.sources.map((source) => source.license),
      ...(icon.rights ? [icon.rights.licenseText] : []),
    ]),
  );
  // Owner conditions travel with any build that contains owner or brand artwork.
  if (artworks.some((icon) => icon.rights)) licenses.add("licenses/owner-artwork.md");
  await mkdir(join(out, "licenses"), { recursive: true });
  for (const license of licenses) await cp(join(root, license), join(out, license));
  // The project licence and its third-party exceptions travel with every build.
  for (const file of releaseNotices) await cp(join(root, file), join(out, file));
  const lines = [
    "# Modern File Icons — notices (" + profile + " build)",
    "",
    "Artwork sources, licences, credits and trademark notes for every SVG in this build. Full licence texts are in `licenses/`. Third-party trademarks belong to their owners; their use does not imply endorsement. Meeting a licence's attribution terms does not clear trademark or owner restrictions; release status is listed per artwork.",
    "",
  ];
  if (profile === "preview") {
    lines.push(
      "**Local preview build.** It includes artwork held from release while licence, trademark or permission questions remain open. Do not redistribute it; use the release build for distribution.",
      "",
    );
  }
  const used = (license: string) => licenses.has(license);
  lines.push("## Credits", "");
  for (const [license, credit] of credits) if (used(license)) lines.push("- " + credit);
  lines.push("", "## Licence texts", "");
  for (const license of [...licenses].sort()) lines.push("- `" + license + "`");
  const owned = artworks.filter((icon) => icon.rights);
  if (owned.length) {
    lines.push(
      "",
      "## Owner and brand artwork",
      "",
      profile === "preview"
        ? "Credits, licences and change notices for brand and owner artwork, from the rights register. They satisfy the attribution terms only. Held artwork also lists its unresolved trademark, permission or redistribution questions; it is excluded from release builds."
        : "Credits, licences and change notices for included brand and owner artwork. See licenses/owner-artwork.md for applicable conditions.",
      "",
    );
    for (const icon of owned) {
      const r = icon.rights;
      if (r) lines.push("- `" + icon.id + "`: " + r.credit + " (" + r.license + ").");
    }
  }
  lines.push(
    "",
    "Changes Modern File Icons made to upstream artwork are listed per artwork. Theme colours and strokes are applied when each icon is built.",
    "",
    "## Artwork",
    "",
  );
  for (const icon of artworks) {
    lines.push("### " + icon.id, "");
    for (const source of icon.sources) {
      lines.push(
        "- " +
          source.library +
          " " +
          source.icon +
          " (" +
          source.version +
          "), `" +
          source.license +
          "`",
      );
    }
    const r = icon.rights;
    if (r) {
      lines.push(
        "- Licence: " +
          r.license +
          " (`" +
          r.licenseText +
          "`)" +
          (r.shareAlike ? "; this file is shared under the same licence" : "") +
          (r.noDerivatives
            ? "; only unmodified or technically converted copies may be shared"
            : ""),
      );
      lines.push("- Credit: " + r.credit);
      if (r.source) lines.push("- Source: " + r.source);
      if (r.notice) lines.push("- Notice: " + r.notice);
      lines.push("- Changes: " + r.changes);
    } else if (icon.modifications) {
      lines.push("- Changes: " + icon.modifications);
    }
    if (icon.trademark) lines.push("- Trademark: " + icon.trademark);
    lines.push("");
  }
  await writeFile(join(out, "NOTICE.md"), lines.join("\n"));
}

// Attribution each upstream licence asks for, keyed by its notice file.
const credits: Array<[string, string]> = [
  ["licenses/lucide-isc.md", "Lucide icons, © Lucide Icons and Contributors, ISC License."],
  ["licenses/hugeicons-mit.md", "Hugeicons free icons, © Hugeicons, MIT License."],
  [
    "licenses/solar-cc-by-4-0.md",
    "Solar Icons Set by 480 Design (https://www.figma.com/community/file/1166831539721848736), licensed under CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); React package © Hakim Saoudi, MIT License. Modified as described per artwork.",
  ],
  ["licenses/phosphor-mit.md", "Phosphor Icons, © Phosphor Icons, MIT License."],
  [
    "licenses/material-icon-theme-mit.md",
    "Material Icon Theme, © Material Extensions, MIT License.",
  ],
  [
    "licenses/simple-icons-cc0.md",
    "Simple Icons, CC0 1.0 Universal; brand marks remain trademarks of their owners.",
  ],
  [
    "licenses/mdi-apache-2-0.md",
    "Material Design Icons by Pictogrammers, Apache License 2.0 (full text included).",
  ],
  [
    "licenses/mdi-brand-icons.md",
    "Material Design Icons brand redraws: outside the MDI licence; see mdi-brand-icons.md.",
  ],
  [
    "licenses/owner-artwork.md",
    "Owner and brand artwork: terms, credits, conditions and release status per decision in owner-artwork.md.",
  ],
];

// Verification sizes in layout pixels: 18 px and 24 px icons and an enlarged 96 px view.
const verifySizes = [18, 24, 96];
// A state passes when at most ratioTolerance of pixels differ by more than pixelTolerance
// on any channel. At 18 px and 24 px that allows no differing pixel at all.
const pixelTolerance = 24;
const ratioTolerance = 0.001;

export type Verification = {
  id: string;
  state: State;
  mode: Mode;
  size: number;
  pass: boolean;
  ratio: number;
  maxDelta: number;
  error?: string;
  note?: string;
};

/**
 * Give the root's nested viewports explicit sizes. A nested <svg> without width/height fills
 * its parent viewport, so enlarging the reference's viewBox for the bleed would enlarge it too.
 */
function pinNestedViewports(root: Element): void {
  const [, , width = 0, height = 0] = (root.getAttribute("viewBox") ?? "")
    .split(/[\s,]+/)
    .map(Number);
  for (const child of childElements(root)) {
    if (child.localName !== "svg") continue;
    for (const [name, size] of [
      ["width", width],
      ["height", height],
      ["x", width],
      ["y", height],
    ] as const) {
      const value = child.getAttribute(name);
      if (value === null && (name === "width" || name === "height"))
        child.setAttribute(name, String(size));
      else if (value?.endsWith("%"))
        child.setAttribute(name, String((Number(value.slice(0, -1)) / 100) * size));
    }
  }
}

const browserTransformNote =
  "Reference applies the artwork's CSS transform as browsers do; resvg ignores CSS transforms. Chromium verification (theme:verify-browser) confirms it.";

function compare(
  reference: string,
  output: string,
  canvas: number,
): { ratio: number; maxDelta: number } {
  const a = pixels(reference, canvas);
  const b = pixels(output, canvas);
  let different = 0;
  let maxDelta = 0;
  for (let i = 0; i < a.length; i += 4) {
    let delta = 0;
    for (let c = 0; c < 4; c += 1) {
      delta = Math.max(delta, Math.abs((a[i + c] ?? 0) - (b[i + c] ?? 0)));
    }
    maxDelta = Math.max(maxDelta, delta);
    if (delta > pixelTolerance) different += 1;
  }
  return { ratio: different / (a.length / 4), maxDelta };
}

/**
 * Render every preview output that uses its own selection against the selector's display rules,
 * in the same bleed frame so ink beyond the icon box is compared too.
 */
export async function verifyPreview(
  root: string,
  selectorPath: string,
  outcomes: BuildOutcome[],
  loaded: Theme,
  bleed: number,
): Promise<Verification[]> {
  const records = await readReviewRecords(root);
  const source = await readSelector(selectorPath);
  if (source.sha256 !== loaded.theme.source.selector.sha256) {
    throw new Error(
      "selector HTML " +
        source.file +
        " is not the one theme.json was imported from; refusing to verify",
    );
  }
  const calibration = hydrateCalibration(records.calibration, source);
  const results: Verification[] = [];
  for (const outcome of outcomes) {
    if (outcome.fallback) continue;
    const pick = records.decisions[outcome.id]?.primary;
    // Canonical artwork outside the selector library has no selector rendering to compare with.
    if (pick?.icon.startsWith("icon:")) continue;
    const row = source.rows.get(outcome.id);
    const decision = loaded.theme.decisions[outcome.id];
    if (!pick || !row || !decision) continue;
    const states: State[] = decision.kind === "folder" ? ["closed", "open"] : ["closed"];
    for (const state of states) {
      for (const mode of modes) {
        const file = outcome.files[state][mode];
        let reference = "";
        let output = "";
        let failure: string | null = null;
        let note: string | undefined;
        try {
          if (!file) throw new Error("no output file");
          const document = selectorReference(
            source,
            calibration,
            records.globalColor,
            row,
            pick,
            state,
            mode,
          );
          const referenceRoot = rootOf(document);
          pinNestedViewports(referenceRoot);
          const styles = elementsOf(referenceRoot).filter(
            (element) => element.localName === "style",
          );
          if (styles.some((style) => /transform\s*:/.test(style.textContent ?? ""))) {
            resolveStyles(referenceRoot);
            note = browserTransformNote;
          }
          reference = framedSvg(serializeSvg(document), bleed);
          output = await readFile(file, "utf8");
        } catch (error) {
          failure = error instanceof Error ? error.message : String(error);
        }
        for (const size of verifySizes) {
          const canvas = bleedBox(size, bleed).image;
          if (failure || !Number.isInteger(canvas)) {
            const message = failure ?? "bleed does not give whole pixels at " + size + " px";
            results.push({
              id: outcome.id,
              state,
              mode,
              size,
              pass: false,
              ratio: 1,
              maxDelta: 255,
              error: message,
            });
            continue;
          }
          const result = compare(reference, output, canvas);
          const entry: Verification = {
            id: outcome.id,
            state,
            mode,
            size,
            pass: result.ratio <= ratioTolerance,
            ...result,
          };
          if (note) entry.note = note;
          results.push(entry);
        }
      }
    }
  }
  return results;
}

function report(
  loaded: Theme,
  builds: Record<Profile, BuildOutcome[]>,
  bleed: number,
  verifications: Verification[] | null,
): { markdown: string; json: unknown } {
  const { theme, icons } = loaded;
  const byId = (list: BuildOutcome[]) => new Map(list.map((outcome) => [outcome.id, outcome]));
  const preview = byId(builds.preview);
  const release = byId(builds.release);
  const checks = new Map<string, Verification[]>();
  for (const result of verifications ?? []) {
    checks.set(result.id, [...(checks.get(result.id) ?? []), result]);
  }
  const rows = Object.entries(theme.decisions)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([id, decision]) => {
      const verify = checks.get(id) ?? [];
      const artwork = decision.artwork ? icons.get(decision.artwork) : undefined;
      return {
        id,
        selection: decision.selection.icon,
        artwork: decision.artwork ?? null,
        reproduced: decision.artwork !== undefined,
        reason: decision.unavailable ?? null,
        verification:
          verifications === null
            ? "not run"
            : verify.length === 0
              ? "n/a"
              : verify.every((v) => v.pass)
                ? "pass"
                : "FAIL",
        worstPixelRatio: verify.length ? Math.max(...verify.map((v) => v.ratio)) : null,
        bleeds: preview.get(id)?.fallback ? false : (preview.get(id)?.bleeds ?? false),
        preview: preview.get(id)?.fallback ? "fallback" : "selected",
        previewReason: preview.get(id)?.fallback ?? null,
        release: release.get(id)?.fallback ? "fallback" : "selected",
        releaseReason: release.get(id)?.fallback ?? null,
        releaseBasis: artwork?.release?.basis ?? null,
        rightsAssessment: artwork?.rights?.assessment ?? null,
        unresolved: artwork?.rights?.unresolved?.length ?? 0,
      };
    });
  type Row = (typeof rows)[number];
  const count = (predicate: (row: Row) => boolean) => rows.filter(predicate).length;
  const summary = {
    decisions: rows.length,
    reproduced: count((r) => r.reproduced),
    verified: count((r) => r.verification === "pass"),
    verificationFailures: count((r) => r.verification === "FAIL"),
    previewSelected: count((r) => r.preview === "selected"),
    previewFallback: count((r) => r.preview === "fallback"),
    releaseSelected: count((r) => r.release === "selected"),
    releaseFallback: count((r) => r.release === "fallback"),
    drawsIntoBleed: count((r) => r.bleeds),
    bleedPerSide: bleed,
  };
  const list = (items: Row[], line: (row: Row) => string) =>
    items.length ? items.map(line) : ["None."];
  // A section that only appears when it has something to report.
  const section = (title: string, items: Row[], line: (row: Row) => string) =>
    items.length ? ["## " + title, "", ...items.map(line), ""] : [];
  const lines = [
    "# Modern File Icons build report",
    "",
    "Theme " +
      theme.id +
      " " +
      theme.version +
      " from review selector seed `" +
      theme.source.selector.seedId +
      "`.",
    "",
    "Verification renders each preview SVG and the selector-equivalent reference (the selector's embedded artwork with its stroke, calibration and colour rules applied) with resvg at " +
      verifySizes.join(", ") +
      " px icon sizes in light and dark, closed and open, in the same bleed frame, so ink beyond the icon box is compared too. A state passes when at most " +
      ratioTolerance * 100 +
      "% of pixels differ by more than " +
      pixelTolerance +
      "/255 (no differing pixel at 18 px or 24 px). The reference reproduces the selector's rules in resvg; browser rendering is verified separately with `bun run theme:verify-browser`.",
    "",
    "| Measure | Value |",
    "| --- | ---: |",
    ...Object.entries(summary).map(([key, value]) => "| " + key + " | " + value + " |"),
    "",
    ...section(
      "Not reproduced: generic fallback in every build",
      rows.filter((r) => !r.reproduced),
      (r) => "- `" + r.id + "` (" + r.selection + "): " + r.reason,
    ),
    "## Verification failures",
    "",
    ...list(
      rows.filter((r) => r.verification === "FAIL"),
      (r) => {
        const failed = (checks.get(r.id) ?? []).filter((v) => !v.pass);
        return (
          "- `" +
          r.id +
          "`: " +
          failed
            .map(
              (v) =>
                v.state +
                "/" +
                v.mode +
                "/" +
                v.size +
                "px " +
                (v.error ?? (v.ratio * 100).toFixed(2) + "% pixels, max delta " + v.maxDelta),
            )
            .join("; ")
        );
      },
    ),
    "",
    ...section(
      "Release build: selected artwork held from distribution",
      rows.filter((r) => r.reproduced && r.release === "fallback"),
      (r) => "- `" + r.id + "` (" + r.artwork + "): " + r.releaseReason,
    ),
    ...section(
      "Verification notes",
      rows.filter((r) => (checks.get(r.id) ?? []).some((v) => v.note)),
      (r) => "- `" + r.id + "`: " + ((checks.get(r.id) ?? []).find((v) => v.note)?.note ?? ""),
    ),
    "## Bleed",
    "",
    count((r) => r.bleeds) +
      " decisions draw into the bleed area. Every SVG is padded by " +
      bleed * 24 +
      " of 24 units per side; hosts draw each image at size × " +
      (1 + 2 * bleed).toFixed(4) +
      " with a margin of −size × " +
      bleed.toFixed(4) +
      ". report.json lists every decision in detail.",
    "",
  ];
  return { markdown: lines.join("\n"), json: { summary, decisions: rows, verifications } };
}

export async function buildTheme(
  root = projectRoot,
  out = join(projectRoot, "dist", "modern-file-icons"),
  selectorPath: string | null = null,
): Promise<{ failures: number; summary: unknown }> {
  const loaded = await loadTheme(root);
  // Preview contains every reproduced artwork, so its bleed covers the release build as well.
  const preview = await buildProfile(loaded, root, join(out, "preview"), "preview");
  const release = await buildProfile(loaded, root, join(out, "release"), "release", preview.bleed);
  const verifications = selectorPath
    ? await verifyPreview(root, selectorPath, preview.outcomes, loaded, preview.bleed)
    : null;
  const result = report(
    loaded,
    { preview: preview.outcomes, release: release.outcomes },
    preview.bleed,
    verifications,
  );
  await writeFile(join(out, "report.md"), result.markdown);
  await writeFile(join(out, "report.json"), JSON.stringify(result.json, null, 2) + "\n");
  const summary = (result.json as { summary: unknown }).summary;
  return { failures: verifications?.filter((v) => !v.pass).length ?? 0, summary };
}

/**
 * Check the repository as it would be published: copy it without held/ (and without dist/,
 * .git and node_modules), then validate it, check rights and build the release profile there.
 * No audited artwork may be present in that tree or reach its release output.
 */
export async function publicCheck(
  root = projectRoot,
): Promise<{ decisions: number; fallbacks: number; absent: number }> {
  const work = await mkdtemp(join(tmpdir(), "mfi-public-"));
  try {
    const skipped = /^\/(?:held|node_modules|dist|\.git)(?:\/|$)/;
    await cp(root, work, {
      recursive: true,
      filter: (path) => !skipped.test(path.slice(root.length)),
    });
    await symlink(join(root, "node_modules"), join(work, "node_modules"));
    await checkRights(work);
    const loaded = await loadTheme(work);
    const registered = [...loaded.rights.byArtwork.keys()];
    const present = registered.filter(
      (id) => loaded.icons.has(id) && loaded.icons.get(id)?.release?.status !== "eligible",
    );
    if (present.length) throw new Error("held artwork in the public tree: " + present.join(", "));
    const release = await buildProfile(loaded, work, join(work, "dist", "release"), "release");
    const notice = await readFile(join(work, "dist", "release", "NOTICE.md"), "utf8");
    const held = registered.filter((id) => loaded.icons.get(id)?.release?.status !== "eligible");
    const leaked = held.filter((id) => notice.includes("### " + id + "\n"));
    if (leaked.length)
      throw new Error("held artwork in the public release build: " + leaked.join(", "));
    return {
      decisions: release.outcomes.length,
      fallbacks: release.outcomes.filter((outcome) => outcome.fallback).length,
      absent: loaded.absent.size,
    };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const [action, ...args] = process.argv.slice(2);
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  try {
    const root = resolve(option("--root") ?? projectRoot);
    if (action === "validate") {
      const loaded = await loadTheme(root);
      console.log("Theme is valid (" + Object.keys(loaded.theme.decisions).length + " decisions).");
    } else if (action === "build") {
      const selector = option("--selector");
      const out = resolve(option("--out") ?? join(root, "dist", "modern-file-icons"));
      const result = await buildTheme(root, out, selector ? resolve(selector) : null);
      console.log(JSON.stringify(result.summary, null, 2));
      console.log("Wrote " + out + " (preview, release, report.md, report.json).");
      if (result.failures) {
        console.error(result.failures + " verification checks failed; see report.md.");
        process.exitCode = 1;
      }
    } else if (action === "public-check") {
      const result = await publicCheck(root);
      console.log(
        "Public-safe checkout validates and builds without held/: " +
          result.decisions +
          " decisions, " +
          result.fallbacks +
          " release fallbacks, " +
          result.absent +
          " held artworks absent.",
      );
    } else {
      console.error(
        "Usage: bun tools/theme.ts <validate|build|public-check> [--root <dir>] [--out <dir>] [--selector <html>]",
      );
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
