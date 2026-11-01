import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { Document, Element } from "@xmldom/xmldom";
import {
  childElements,
  elementsOf,
  fixHtmlAttributeCase,
  parseSvg,
  resolveVariable,
  rootOf,
  svgNamespace,
} from "./svg-normalize.ts";

// Port of the file-icon selector v6.12 review rules (selection, calibration and display).
// The selector HTML is the visual reference the user approved; these functions must reproduce
// its rendering order exactly: pick stroke, Material recolour, calibration, then inherited colour.

export type Mode = "light" | "dark";
export const modes: readonly Mode[] = ["light", "dark"];

export type SelectorPick = {
  icon: string;
  colorMode: string;
  hex: string | null;
  stroke: number | null;
  expandedIcon: string | null;
  artworkStatus?: string;
  visualApproved?: boolean;
};
export type Decision = {
  kind: "file" | "folder";
  primary: SelectorPick;
  alternatives: SelectorPick[];
};
export type GlobalColor = { token: string; customLight: string; customDark: string };
export type JsonRecord = Record<string, unknown>;

export type SelectorRow = {
  id: string;
  kind: "file" | "folder";
  aliases: Record<string, string[]>;
  representativeColor: string | null;
  materialId: string | null;
  lightMaterialId: string | null;
  candidateRights: Record<string, JsonRecord>;
};
export type SelectorAsset = JsonRecord & { svg: string; pack: string };
export type CalibrationMeta = { mode: string | null; pack: string | null; folder: boolean };
export type CalibrationValues = {
  size: number;
  x: number;
  y: number;
  openX: number;
  openY: number;
  stroke: number;
};
export type Calibration = {
  packs: Record<string, CalibrationValues>;
  overrides: Record<string, CalibrationValues & { pack?: string; mode: string | null }>;
};

export type SelectorSource = {
  file: string;
  sha256: string;
  seedId: string;
  rows: Map<string, SelectorRow>;
  assets: Record<string, SelectorAsset>;
  meta: Record<string, CalibrationMeta>;
  defaults: Record<string, CalibrationValues>;
  colorOptions: Record<string, { light: string; dark: string }>;
  seedSelections: Record<string, { primary: SelectorPick; alternatives: SelectorPick[] }>;
  seedCalibration: unknown;
};

// Inherited text colour of the selector's preview tiles (CSS --ink) when artwork uses currentColor.
export const selectorInk: Record<Mode, string> = { light: "#111827", dark: "#e5e7eb" };
const paintConstants = 'blue:"#365BD8",black:"#111827",white:"#FFFFFF",muted:"#8491A5"';
const fixedColors: Record<string, string> = {
  blue: "#365BD8",
  black: "#111827",
  white: "#FFFFFF",
  muted: "#8491A5",
};
const fields: Record<keyof CalibrationValues, [number, number]> = {
  size: [6, 19],
  stroke: [0.5, 4.5],
  x: [5, 18],
  y: [5, 18],
  openX: [5, 18],
  openY: [5, 18],
};
const wholeFields: Record<keyof CalibrationValues, [number, number]> = {
  size: [8, 36],
  stroke: [0.4, 2.5],
  x: [-10, 10],
  y: [-10, 10],
  openX: [-10, 10],
  openY: [-10, 10],
};
const standaloneDefault: CalibrationValues = {
  size: 24,
  x: 0,
  y: 0,
  openX: 0,
  openY: 0,
  stroke: 1,
};
const calibrationKeys = Object.keys(fields) as Array<keyof CalibrationValues>;

export function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function text(record: JsonRecord, key: string): string | null {
  const value = record[key];
  return typeof value === "string" ? value : null;
}

function requireRecord(value: unknown, label: string): JsonRecord {
  if (!isRecord(value)) throw new Error(label + " must be an object");
  return value;
}

export function parsePick(value: unknown, label: string): SelectorPick {
  const pick = requireRecord(value, label);
  const icon = text(pick, "icon");
  const colorMode = text(pick, "colorMode");
  if (!icon || !colorMode) throw new Error(label + " needs icon and colorMode");
  const stroke = pick.stroke;
  if (stroke !== null && stroke !== undefined && typeof stroke !== "number") {
    throw new Error(label + " stroke must be a number or null");
  }
  const parsed: SelectorPick = {
    icon,
    colorMode,
    hex: text(pick, "hex"),
    stroke: typeof stroke === "number" ? stroke : null,
    expandedIcon: text(pick, "expandedIcon"),
  };
  const status = text(pick, "artworkStatus");
  if (status) parsed.artworkStatus = status;
  if (typeof pick.visualApproved === "boolean") parsed.visualApproved = pick.visualApproved;
  return parsed;
}

function scriptBlocks(html: string): Map<string, string> {
  const blocks = new Map<string, string>();
  for (const match of html.matchAll(
    /<script id="([^"]+)" type="application\/json">([\s\S]*?)<\/script>/g,
  )) {
    if (match[1] && match[2] !== undefined) blocks.set(match[1], match[2]);
  }
  return blocks;
}

function parseDefaults(code: string): Record<string, CalibrationValues> {
  const start = code.indexOf("const DEFAULT = {");
  const end = code.indexOf("\n};", start);
  if (start < 0 || end < 0) throw new Error("selector calibration defaults not found");
  const section = code.slice(start, end);
  const defaults: Record<string, CalibrationValues> = {};
  const pattern =
    /(\w+):\{pack:'(\w+)'[^}]*?size:([\d.]+),x:([\d.]+),y:([\d.]+),openX:([\d.]+),openY:([\d.]+),stroke:([\d.]+)/g;
  for (const m of section.matchAll(pattern)) {
    if (m[1] !== m[2]) throw new Error("unexpected selector default pack " + m[1]);
    defaults[m[1] ?? ""] = {
      size: Number(m[3]),
      x: Number(m[4]),
      y: Number(m[5]),
      openX: Number(m[6]),
      openY: Number(m[7]),
      stroke: Number(m[8]),
    };
  }
  const expected = ["lucide", "hugeicons", "phosphor", "devicons", "owner", "brandvar", "solar"];
  if (
    expected.some((pack) => !defaults[pack]) ||
    Object.keys(defaults).length !== expected.length
  ) {
    throw new Error("selector calibration defaults changed; expected the v6.12 packs");
  }
  return defaults;
}

function parseColorOptions(code: string): Record<string, { light: string; dark: string }> {
  const start = code.indexOf("{", code.indexOf("nativeColorOptions = {"));
  if (start < 0) throw new Error("selector colour options not found");
  let depth = 0;
  for (let i = start; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    if (code[i] === "}" && --depth === 0) {
      const parsed = requireRecord(JSON.parse(code.slice(start, i + 1)), "colour options");
      const options: Record<string, { light: string; dark: string }> = {};
      for (const [key, value] of Object.entries(parsed)) {
        const option = requireRecord(value, "colour option " + key);
        const light = text(option, "light");
        const dark = text(option, "dark");
        if (!light || !dark) throw new Error("colour option " + key + " needs light and dark");
        options[key] = { light, dark };
      }
      return options;
    }
  }
  throw new Error("selector colour options are unterminated");
}

export async function readSelector(path: string): Promise<SelectorSource> {
  const bytes = await readFile(path);
  const html = bytes.toString("utf8");
  const blocks = scriptBlocks(html);
  const block = (id: string): unknown => {
    const value = blocks.get(id);
    if (value === undefined) throw new Error("selector block " + id + " is missing");
    return JSON.parse(value) as unknown;
  };
  const review = requireRecord(block("review-data"), "review-data");
  const seed = requireRecord(block("selector-seed"), "selector-seed");
  const metaBlock = requireRecord(block("selector-calibration-meta"), "selector-calibration-meta");
  const code = html.replace(/<script id="[^"]+" type="application\/json">[\s\S]*?<\/script>/g, "");
  if (
    !code.includes(paintConstants) ||
    !html.includes("--ink:#111827") ||
    !html.includes("--ink:#e5e7eb")
  ) {
    throw new Error("selector paint constants differ from v6.12; update the port before importing");
  }

  const rows = new Map<string, SelectorRow>();
  if (!Array.isArray(review.rows)) throw new Error("review-data rows must be an array");
  for (const value of review.rows) {
    const row = requireRecord(value, "review row");
    const id = text(row, "id");
    const kind = text(row, "kind");
    if (!id || (kind !== "file" && kind !== "folder")) throw new Error("invalid review row");
    const aliases: Record<string, string[]> = {};
    for (const [group, keys] of Object.entries(requireRecord(row.aliases, id + " aliases"))) {
      if (!Array.isArray(keys) || keys.some((key) => typeof key !== "string")) {
        throw new Error(id + " aliases." + group + " must be strings");
      }
      aliases[group] = keys as string[];
    }
    const rights: Record<string, JsonRecord> = {};
    for (const [candidate, entry] of Object.entries(requireRecord(row.candidateRights ?? {}, id))) {
      if (isRecord(entry)) rights[candidate] = entry;
    }
    rows.set(id, {
      id,
      kind,
      aliases,
      representativeColor: text(row, "representativeColor"),
      materialId: text(row, "materialId"),
      lightMaterialId: text(row, "lightMaterialId"),
      candidateRights: rights,
    });
  }

  const assets: Record<string, SelectorAsset> = {};
  for (const [id, value] of Object.entries(requireRecord(review.assets, "assets"))) {
    const asset = requireRecord(value, "asset " + id);
    const svg = text(asset, "svg");
    const pack = text(asset, "pack");
    if (svg && pack) assets[id] = { ...asset, svg, pack };
  }

  const meta: Record<string, CalibrationMeta> = {};
  for (const [id, value] of Object.entries(metaBlock)) {
    if (!isRecord(value)) continue;
    meta[id] = {
      mode: text(value, "mode"),
      pack: text(value, "pack"),
      folder: value.folder === true,
    };
  }

  const seedSelections: SelectorSource["seedSelections"] = {};
  for (const [id, value] of Object.entries(requireRecord(seed.selections, "seed selections"))) {
    const entry = requireRecord(value, "seed " + id);
    const alternatives = Array.isArray(entry.alternatives) ? entry.alternatives : [];
    seedSelections[id] = {
      primary: parsePick(entry.primary, "seed " + id),
      alternatives: alternatives.map((alt, index) =>
        parsePick(alt, "seed " + id + " alt " + index),
      ),
    };
  }

  return {
    file: path.split("/").at(-1) ?? path,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    seedId: text(seed, "seedId") ?? "",
    rows,
    assets,
    meta,
    defaults: parseDefaults(code),
    colorOptions: parseColorOptions(code),
    seedSelections,
    seedCalibration: seed.calibration,
  };
}

function clamp(value: number, [min, max]: [number, number]): number {
  return Math.round(Math.max(min, Math.min(max, value)) * 10) / 10;
}

/** The selector's hydrate(): clamp stored calibration onto its built-in defaults. */
export function hydrateCalibration(
  stored: unknown,
  source: Pick<SelectorSource, "defaults" | "meta">,
): Calibration {
  const packs: Record<string, CalibrationValues> = {};
  for (const [pack, values] of Object.entries(source.defaults)) packs[pack] = { ...values };
  const overrides: Calibration["overrides"] = {};
  if (!isRecord(stored)) return { packs, overrides };
  const storedPacks = isRecord(stored.packs) ? stored.packs : {};
  for (const [pack, values] of Object.entries(packs)) {
    const entry = isRecord(storedPacks[pack]) ? storedPacks[pack] : {};
    for (const key of calibrationKeys) {
      const value = Number(entry[key]);
      if (Number.isFinite(value)) values[key] = clamp(value, fields[key]);
    }
  }
  const storedOverrides = isRecord(stored.overrides) ? stored.overrides : {};
  for (const [id, value] of Object.entries(storedOverrides)) {
    const info = source.meta[id];
    if (!info || !isRecord(value)) continue;
    const pack = info.pack;
    const ranges = pack ? fields : wholeFields;
    const defaults = pack ? packs[pack] : standaloneDefault;
    if (!defaults) throw new Error("calibration override " + id + " uses unknown pack " + pack);
    const state = {} as CalibrationValues;
    for (const key of calibrationKeys) {
      const number = Number(value[key]);
      state[key] = Number.isFinite(number) ? clamp(number, ranges[key]) : defaults[key];
    }
    overrides[id] = { ...(pack ? { pack } : {}), mode: info.mode, ...state };
  }
  return { packs, overrides };
}

export type PaintResult = { color: string; original: boolean };

/** The selector's paint(): which colour the artwork's currentColor inherits, and in what mode. */
export function paint(
  row: SelectorRow,
  pick: SelectorPick,
  asset: SelectorAsset | undefined,
  mode: Mode,
  globalColor: GlobalColor,
  colorOptions: SelectorSource["colorOptions"],
): PaintResult {
  const brandHex = asset ? text(asset, "brandHex") : null;
  if (pick.icon.startsWith("simple:") || asset?.pack === "owner-artwork") {
    return { color: brandHex || "currentColor", original: true };
  }
  const m = pick.colorMode;
  if (m === "original") return { color: "currentColor", original: true };
  const native =
    globalColor.token === "custom"
      ? mode === "dark"
        ? globalColor.customDark
        : globalColor.customLight
      : colorOptions[globalColor.token]?.[mode];
  const colors: Record<string, string | undefined> = {
    ...fixedColors,
    native,
    material: row.representativeColor || "currentColor",
    foreground: colorOptions["primary-text"]?.[mode],
    custom: pick.hex || "#365BD8",
    brand: brandHex || "currentColor",
  };
  return { color: colors[m] || "currentColor", original: false };
}

export function resolvedColor(result: PaintResult, mode: Mode): string {
  return result.color === "currentColor" ? selectorInk[mode] : result.color;
}

function strokeBase(asset: SelectorAsset): number {
  const declared = Number(asset.strokeBase);
  if (asset.strokeBase !== undefined && asset.strokeBase !== null && declared) return declared;
  const name = text(asset, "name") ?? "";
  if (asset.pack === "lucide") return 2;
  if (asset.pack === "custom" && (name === "FolderLink" || name === "FolderStar")) return 2;
  if (asset.pack === "prototype" && name.startsWith("Folder")) return 2;
  if (asset.pack === "proposal" && name.includes("folder-")) return 2;
  return 1.5;
}

/** The selector's number formatting for scaled stroke widths. */
export function formatStroke(value: number): string {
  return value.toFixed(3).replace(/0+$/, "").replace(/\.$/, "");
}

function strokeAll(svg: string, multiplier: number): string {
  return svg.replace(
    /stroke-width="(\d+(?:\.\d+)?)"/g,
    (_all, width: string) => 'stroke-width="' + formatStroke(Number(width) * multiplier) + '"',
  );
}

function motifCut(svg: string, kind: "file" | "folder"): number {
  let cut = svg.indexOf("<svg", 1);
  if (cut < 0 && kind === "folder") {
    const rootEnd = svg.indexOf(">") + 1;
    if (/^\s*<path/.test(svg.slice(rootEnd))) {
      const group = svg.indexOf("<g", rootEnd);
      if (group > 0) cut = group;
    }
  }
  return cut;
}

/** The selector's strokeSvg(): apply a pick's stroke width before calibration. */
export function strokeSvg(
  svg: string,
  pick: SelectorPick,
  asset: SelectorAsset,
  kind: "file" | "folder",
): string {
  if (asset.stroke !== true || !pick.stroke) return svg;
  const multiplier = Number(pick.stroke) / strokeBase(asset);
  const cut = motifCut(svg, kind);
  if (cut < 0) return strokeAll(svg, multiplier);
  if (asset.protectMotif === true) return svg;
  let motif = svg.slice(cut);
  const end = motif.indexOf(">");
  const head = motif.slice(0, end);
  if (!/\sstroke-width=/.test(head)) {
    const outer = /stroke-width="(\d+(?:\.\d+)?)"/.exec(svg.slice(0, cut));
    if (outer) motif = head + ' stroke-width="' + outer[1] + '"' + motif.slice(end);
  }
  return svg.slice(0, cut) + strokeAll(motif, multiplier);
}

export type StrokeSpec = { scope: "all" | "motif"; scale: number; motifWidth?: number };

/**
 * Express a pick's stroke as an operation on calibrated artwork. Scaling commutes with
 * calibration except where strokeSvg() copies an inherited width onto the motif first.
 */
export function strokeSpec(
  pick: SelectorPick,
  asset: SelectorAsset,
  kind: "file" | "folder",
  calibrationFactor: number,
): StrokeSpec | null {
  if (asset.stroke !== true || !pick.stroke) return null;
  const scale = Number(pick.stroke) / strokeBase(asset);
  const cut = motifCut(asset.svg, kind);
  if (cut < 0) return { scope: "all", scale };
  if (asset.protectMotif === true) return null;
  const spec: StrokeSpec = { scope: "motif", scale };
  const head = asset.svg.slice(cut, cut + asset.svg.slice(cut).indexOf(">"));
  if (!/\sstroke-width=/.test(head)) {
    const outer = /stroke-width="(\d+(?:\.\d+)?)"/.exec(asset.svg.slice(0, cut));
    if (outer) {
      const width = Number(formatStroke(Number(outer[1]) * scale));
      spec.motifWidth = Math.round(width * calibrationFactor * 1000) / 1000;
    }
  }
  return spec;
}

/** The selector's Material recolour for non-original treatments of Material artwork. */
export function recolorMaterial(svg: string): string {
  return svg.replace(
    /(fill|stroke)="#[0-9a-fA-F]{3,8}"/g,
    (_all, name: string) => name + '="currentColor"',
  );
}

function tuneStroke(node: Element, stroke: number, baseline: number): void {
  const factor = Number(stroke) / (Number(baseline) || 1);
  for (const element of elementsOf(node)) {
    const value = element.getAttribute("stroke-width");
    if (value === null) continue;
    const base = Number(value);
    if (Number.isFinite(base)) {
      element.setAttribute("stroke-width", String(Math.round(base * factor * 1000) / 1000));
    }
  }
}

function ensureMovable(document: Document, root: Element, pack: string): Element | null {
  const children = childElements(root);
  if (children.length < 2) return null;
  const motif = children[children.length - 1];
  if (!motif) return null;
  if (motif.localName === "svg") return motif;
  if (motif.localName !== "g") return null;
  const wrapper = document.createElementNS(svgNamespace, "g");
  wrapper.setAttribute("data-calibration-pack", pack);
  root.replaceChild(wrapper, motif);
  wrapper.appendChild(motif);
  return wrapper;
}

export type CalibrationResult = { motif: Element; factor: number } | null;

/**
 * The selector's tuneComposite(): move, resize and re-weight a composite's motif. Open state is
 * detected the same way the selector does: an open folder outline has more than one direct path.
 */
export function calibrateComposite(
  document: Document,
  root: Element,
  calibrationId: string,
  source: Pick<SelectorSource, "meta" | "defaults">,
  calibration: Calibration,
): CalibrationResult {
  const info = source.meta[calibrationId];
  const pack = info?.pack;
  if (!info || info.mode !== "composite" || !pack) return null;
  const config = calibration.overrides[calibrationId] ?? calibration.packs[pack];
  const baseline = source.defaults[pack];
  if (!config || !baseline) return null;
  const motif = ensureMovable(document, root, pack);
  if (!motif) return null;
  const open = info.folder && childElements(root).filter((c) => c.localName === "path").length > 1;
  if (motif.localName === "svg") {
    if (info.folder) {
      motif.setAttribute("width", String(config.size));
      motif.setAttribute("height", String(config.size));
      motif.setAttribute("x", String(open ? config.openX : config.x));
      motif.setAttribute("y", String(open ? config.openY : config.y));
    } else {
      // File-style composites keep their document anchor and apply pack deltas.
      const original = (key: string) => Number(motif.getAttribute(key) || "0");
      const ratio = config.size / baseline.size;
      const [width, height, x, y] = [
        original("width"),
        original("height"),
        original("x"),
        original("y"),
      ];
      motif.setAttribute("width", String(width * ratio));
      motif.setAttribute("height", String(height * ratio));
      motif.setAttribute("x", String(x + (config.x - baseline.x)));
      motif.setAttribute("y", String(y + (config.y - baseline.y)));
    }
  } else {
    const dx = (open ? config.openX : config.x) - (open ? baseline.openX : baseline.x);
    const dy = (open ? config.openY : config.y) - (open ? baseline.openY : baseline.y);
    const scale = config.size / baseline.size;
    motif.setAttribute(
      "transform",
      `translate(${dx} ${dy}) translate(17 17) scale(${scale}) translate(-17 -17)`,
    );
  }
  tuneStroke(motif, config.stroke, baseline.stroke);
  return { motif, factor: Number(config.stroke) / (Number(baseline.stroke) || 1) };
}

/** True when the selector would apply its standalone ("whole artwork") calibration transform. */
export function hasStandaloneCalibration(
  calibrationId: string,
  source: Pick<SelectorSource, "meta">,
  calibration: Calibration,
): boolean {
  return (
    source.meta[calibrationId]?.mode !== "composite" &&
    calibration.overrides[calibrationId] !== undefined
  );
}

/** Selector artwork shown for a pick in a given folder state, including its light Material swap. */
export function displayedArtwork(
  row: SelectorRow,
  pick: SelectorPick,
  state: "closed" | "open",
  mode: Mode,
  assets: SelectorSource["assets"],
): string {
  let id =
    state === "open" && pick.expandedIcon && assets[pick.expandedIcon]
      ? pick.expandedIcon
      : pick.icon;
  if (
    mode === "light" &&
    pick.colorMode === "original" &&
    id === row.materialId &&
    row.lightMaterialId
  ) {
    id = row.lightMaterialId;
  }
  return id;
}

/**
 * Build the SVG the selector displayed for a decision, as a standalone document whose root
 * inherits the paint colour. resvg renders this as the visual-equivalence reference.
 */
export function selectorReference(
  source: SelectorSource,
  calibration: Calibration,
  globalColor: GlobalColor,
  row: SelectorRow,
  pick: SelectorPick,
  state: "closed" | "open",
  mode: Mode,
): Document {
  const id = displayedArtwork(row, pick, state, mode, source.assets);
  const asset = source.assets[id];
  if (!asset) throw new Error("selector asset " + id + " is missing");
  const painted = paint(
    row,
    pick,
    source.assets[pick.icon],
    mode,
    globalColor,
    source.colorOptions,
  );
  let svg = strokeSvg(asset.svg, pick, asset, row.kind);
  if (!painted.original && id.startsWith("material:")) svg = recolorMaterial(svg);
  const document = parseSvg(svg);
  const root = rootOf(document);
  fixHtmlAttributeCase(root);
  if (hasStandaloneCalibration(pick.icon, source, calibration)) {
    throw new Error("standalone calibration transforms are not supported by the port");
  }
  calibrateComposite(document, root, pick.icon, source, calibration);
  // Chromium resolves var() fallbacks in presentation attributes; resvg does not.
  for (const element of elementsOf(root)) {
    const names: string[] = [];
    for (let i = 0; i < element.attributes.length; i += 1) {
      const attribute = element.attributes.item(i);
      if (attribute) names.push(attribute.name);
    }
    for (const name of names) {
      const value = element.getAttribute(name) ?? "";
      if (!value.includes("var(")) continue;
      const fallback = resolveVariable(value);
      if (fallback === null) element.removeAttribute(name);
      else element.setAttribute(name, fallback);
    }
  }
  // An inline color: currentColor on the root inherits from the tile in browsers; resvg would
  // resolve it to black, so the reference drops that declaration before setting the colour.
  const style = root.getAttribute("style");
  if (style !== null) {
    const kept = style
      .split(";")
      .filter((part) => !/^\s*color\s*:\s*(?:currentColor|inherit)\s*$/i.test(part))
      .join(";");
    root.setAttribute("style", kept);
  }
  // The artwork inherits the tile colour unless its root sets its own (currentColor inherits).
  if (inheritsColor(root)) root.setAttribute("color", resolvedColor(painted, mode));
  return document;
}

/** Whether an SVG root takes its colour from the host: no own colour, or currentColor/inherit. */
export function inheritsColor(root: Element): boolean {
  const own = root.getAttribute("color");
  return own === null || own === "currentColor" || own === "inherit";
}

/**
 * CSS pixel size an artwork's root fixes with an inline style. The selector honoured it over its
 * cell size (the inline style beats its 100% rule), so the artwork appeared at that size anywhere.
 */
export function fixedRootSize(svg: string): number | null {
  const root = /^\s*<svg\b[^>]*>/.exec(svg)?.[0] ?? "";
  const style = /\sstyle="([^"]*)"/.exec(root)?.[1] ?? "";
  const read = (name: string) =>
    new RegExp("(?:^|;)\\s*" + name + "\\s*:\\s*([^;]+)").exec(style)?.[1]?.trim() ?? null;
  const width = read("width");
  const height = read("height");
  if (width === null && height === null) return null;
  const px = (value: string | null) =>
    Number(/^(\d+(?:\.\d+)?)px$/.exec(value ?? "")?.[1] ?? Number.NaN);
  const size = px(width);
  if (!Number.isFinite(size) || size !== px(height)) {
    throw new Error("unsupported fixed root size " + width + " x " + height);
  }
  return size;
}

export type ReleaseStatus = { status: "eligible" | "held"; basis: string };

/**
 * Conservative distribution gate from the selector's rights record for one candidate. Only
 * generic source-pack artwork whose obligations are notices or attribution (both carried by the
 * build's NOTICE.md and licences) is eligible; anything conditional, branded, contradictory or
 * unverified is held until checked.
 */
export function releaseStatus(rights: JsonRecord | undefined): ReleaseStatus {
  if (!rights) return { status: "held", basis: "no rights record for this candidate" };
  const action = text(rights, "action") ?? "";
  const permission = text(rights, "usagePermission") ?? "";
  const kind = text(rights, "kind") ?? "";
  const conflicts = ["standalone", "composite", "variation"].filter((key) =>
    /DO NOT/i.test(text(rights, key) ?? ""),
  );
  const unverified = rights.sourceVerified === false;
  const parts = [kind, action, permission].filter(Boolean);
  if (conflicts.length) {
    parts.push(
      "conflicting record: " + conflicts.map((key) => key + " " + text(rights, key)).join(", "),
    );
  }
  if (unverified) parts.push("source not verified");
  const eligible =
    (action === "USE WITH NOTICES" || action === "USE WITH ATTRIBUTION") &&
    permission === "GENERIC LICENSED MOTIF" &&
    conflicts.length === 0 &&
    !unverified;
  return { status: eligible ? "eligible" : "held", basis: parts.join("; ") };
}
