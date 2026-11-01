import { createHash } from "node:crypto";
import { cp, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { format, resolveConfig } from "prettier";
import type { IconMetadata } from "./icon-metadata.generated.ts";
import {
  calibrateComposite,
  displayedArtwork,
  fixedRootSize,
  hasStandaloneCalibration,
  hydrateCalibration,
  isRecord,
  modes,
  paint,
  parsePick,
  readSelector,
  releaseStatus,
  resolvedColor,
  strokeSpec,
  text,
  type Calibration,
  type Decision,
  type GlobalColor,
  type JsonRecord,
  type ReleaseStatus,
  type SelectorAsset,
  type SelectorPick,
  type SelectorSource,
} from "./selector.ts";
import {
  elementsOf,
  fixHtmlAttributeCase,
  parseSvg,
  pinNestedViewports,
  resolveStyles,
  rootOf,
  serializeSvg,
  stripNonRenderingAttributes,
} from "./svg-normalize.ts";
import {
  artworkRights,
  heldIcons,
  loadRights,
  ownerNotice,
  ownerNoticePath,
  registerRelease,
} from "./rights.ts";
import { validateIcons } from "./icons.ts";
import { validateSvg } from "./svg.ts";
import type {
  Decision as ThemeDecision,
  ThemeAssociations,
  ThemeDefinition,
  RightsDecision as RightsEntry,
} from "./theme.generated.ts";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const themeDirectory = "themes/modern-file-icons";
const selectionsPath = themeDirectory + "/selections.json";
const calibrationPath = themeDirectory + "/folder-calibration.json";
const motifId = "motif";

type Source = IconMetadata["sources"][number];
type Category = IconMetadata["category"];
type ReviewRecords = {
  decisions: Record<string, Decision>;
  globalColor: GlobalColor;
  calibration: unknown;
  selectionsSha256: string;
  calibrationSha256: string;
};

const libraries = {
  lucide: { library: "lucide-react", version: "1.53.0", license: "licenses/lucide-isc.md" },
  huge: {
    library: "@hugeicons/core-free-icons",
    version: "4.3.5",
    license: "licenses/hugeicons-mit.md",
  },
  solar: {
    library: "@solar-icons/react",
    version: "2.3.2",
    license: "licenses/solar-cc-by-4-0.md",
  },
  phosphor: {
    library: "@phosphor-icons/react",
    version: "2.1.10",
    license: "licenses/phosphor-mit.md",
  },
  material: {
    library: "material-icon-theme",
    version: "5.39.0",
    license: "licenses/material-icon-theme-mit.md",
  },
  simpleIcons: {
    library: "simple-icons",
    version: "16.34.0",
    license: "licenses/simple-icons-cc0.md",
  },
  mdi: { library: "@mdi/svg", version: "unrecorded", license: "licenses/mdi-apache-2-0.md" },
};

function sha256(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

type Library = { library: string; version: string; license: string };

function source(library: Library, icon: string, version = library.version): Source {
  return { library: library.library, icon, version, license: library.license };
}

export function kebab(value: string): string {
  return value
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Z]+)([A-Z][a-z])/g, "$1-$2")
    .replace(/([A-Za-z])(\d)/g, "$1-$2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

const matchedPacks: Record<string, string> = {
  lucide: "lucide",
  huge: "huge",
  solar: "solar",
  "phosphor-semantic": "phosphor",
};
const variationLibraries: Record<string, string> = {
  "simple-icons": "simple-icons",
  mdi: "mdi",
  ph: "phosphor",
};

/** Stable canonical artwork ID for a selector candidate ID. */
export function canonicalArtworkId(selectorId: string): string {
  const parts = selectorId.split(":");
  const [prefix, name = ""] = parts;
  const open = parts.at(-1) === "open" ? "-open" : "";
  switch (prefix) {
    case "lucide":
      return "lucide-" + kebab(name);
    case "huge":
      return "huge-" + kebab(name.replace(/Icon$/, ""));
    case "solar":
      return "solar-" + kebab(name);
    case "phosphor":
    case "phosphor-semantic": {
      const weight = parts[2] && parts[2] !== "regular" ? "-" + kebab(parts[2]) : "";
      return "phosphor-" + kebab(name) + weight;
    }
    case "material":
      return "material-" + kebab(name);
    case "simple":
      return "simple-icons-" + kebab(name);
    case "matched-folder": {
      const [pack = "", ...glyphParts] = name.split("_");
      const short = matchedPacks[pack];
      if (!short) throw new Error("unsupported matched-folder pack in " + selectorId);
      let glyph = glyphParts.join("_").replace(/_regular$/, "");
      if (pack === "huge") glyph = glyph.replace(/Icon$/, "");
      return "folder-" + short + "-" + kebab(glyph) + open;
    }
    case "owner-pending":
      return (parts[2] === "folder" ? "folder-owner-" : "owner-") + kebab(name) + open;
    case "brandvar": {
      const library = variationLibraries[name];
      if (!library) throw new Error("unsupported variation library in " + selectorId);
      return (
        (parts[3] === "folder" ? "folder-" : "") + library + "-" + kebab(parts[2] ?? "") + open
      );
    }
    case "proposal":
      return kebab(name.replace(/-closed$/, ""));
    default:
      throw new Error("unsupported selector artwork " + selectorId);
  }
}

function categoryOf(selectorId: string, composite: { folder: boolean } | null): Category {
  if (composite) return composite.folder ? "folder" : "file";
  const [prefix, name = ""] = selectorId.split(":");
  if ((prefix === "lucide" || prefix === "huge" || prefix === "solar") && /^folder/i.test(name)) {
    return "folder";
  }
  if (prefix === "huge" && /^(?:File|Doc|Pdf|Csv|Xml|Html|Txt|Zip|Json)/.test(name)) return "file";
  if (prefix === "lucide" && /^File/.test(name)) return "file";
  return "symbol";
}

function glyphSource(reference: string): Source {
  const [pack, name = "", weight] = reference.split(":");
  switch (pack) {
    case "lucide":
      return source(libraries.lucide, name);
    case "huge":
      return source(libraries.huge, name);
    case "solar":
      return source(libraries.solar, name + " (Linear)");
    case "phosphor":
    case "phosphor-semantic":
      return source(libraries.phosphor, name + (weight ? " (" + weight + ")" : ""));
    default:
      throw new Error("unsupported glyph source " + reference);
  }
}

function listedSources(asset: SelectorAsset): Source[] {
  const sources = Array.isArray(asset.sources) ? asset.sources.filter(isRecord) : [];
  return sources.flatMap((entry): Source[] => {
    const library = text(entry, "library") ?? "";
    const icon = text(entry, "icon") ?? "";
    const weight = text(entry, "weight");
    if (library === "lucide-react") return []; // the folder base is added explicitly
    if (library === "Simple Icons") {
      return [source(libraries.simpleIcons, icon, text(entry, "version") ?? "unrecorded")];
    }
    if (library === "Material Design Icons") return [source(libraries.mdi, icon)];
    if (library === "@phosphor-icons/react" || library === "Phosphor") {
      return [source(libraries.phosphor, icon + (weight ? " (" + weight + ")" : ""))];
    }
    throw new Error("unsupported source library " + library);
  });
}

function ownerSource(asset: SelectorAsset): Source {
  const url = text(asset, "ownerUrl") ?? text(asset, "officialKitUrl") ?? "";
  return {
    library: "owner-artwork",
    icon: text(asset, "brandIdentity") ?? "unknown",
    version: /\/([0-9a-f]{40})\//.exec(url)?.[1] ?? "unpinned (copy embedded in selector v6.12)",
    license: ownerNoticePath,
  };
}

function sourcesOf(selectorId: string, asset: SelectorAsset, category: Category): Source[] {
  const [prefix, name = ""] = selectorId.split(":");
  const folderBase = source(
    libraries.lucide,
    selectorId.endsWith(":open") ? "FolderOpen" : "Folder",
  );
  const withFolder = (sources: Source[]) =>
    category === "folder" ? [folderBase, ...sources] : sources;
  switch (prefix) {
    case "lucide":
    case "huge":
    case "solar":
    case "phosphor":
    case "phosphor-semantic":
      return [glyphSource(selectorId)];
    case "material":
      return [source(libraries.material, name + ".svg")];
    case "simple":
      return [source(libraries.simpleIcons, text(asset, "sourceName") ?? name)];
    case "matched-folder":
      return [folderBase, glyphSource(text(asset, "semanticSource") ?? "")];
    case "brandvar":
      return withFolder(listedSources(asset));
    case "owner-pending":
      return withFolder([ownerSource(asset)]);
    case "proposal": {
      const listed = listedSources(asset);
      if (listed.length) return withFolder(listed);
      const document = /Doc0(\d)/.exec(text(asset, "name") ?? "");
      if (document) return [source(libraries.huge, "Doc0" + document[1] + "Icon")];
      throw new Error("no recorded sources for " + selectorId);
    }
    default:
      throw new Error("unsupported selector artwork " + selectorId);
  }
}

type Canonical = {
  svg: string;
  factor: number;
  notes: string[];
  // Format conversions with no visual effect; stated in change notices for licensed artwork.
  technical: string[];
  composite: boolean;
};

/** Correct source licences for audited artwork and record upstream drawings the audit found. */
function auditedSources(sources: Source[], selectorId: string, rights: RightsEntry): Source[] {
  const corrected = sources.map((source) => {
    if (source.library === "owner-artwork" || source.library === "simple-icons") {
      return { ...source, license: rights.copyright.licenseText };
    }
    if (source.library === "@mdi/svg" && selectorId.startsWith("brandvar:mdi:")) {
      return { ...source, license: "licenses/mdi-brand-icons.md" };
    }
    return source;
  });
  const upstream: Record<string, Source> = {
    "material:dune": {
      library: "material-design-icons (Google)",
      icon: "terrain",
      version: "unrecorded",
      license: "licenses/apache-2-0.md",
    },
    "material:yang": {
      library: "@mdi/svg",
      icon: "yin-yang",
      version: "unrecorded",
      license: "licenses/mdi-apache-2-0.md",
    },
  };
  const extra = upstream[selectorId];
  return extra ? [...corrected, extra] : corrected;
}

/**
 * Turn one selector candidate into canonical artwork: the selector's calibration is applied,
 * styles become attributes, nested viewports are flattened, and the result must validate.
 */
export function canonicalize(
  selectorId: string,
  calibrationId: string,
  source: SelectorSource,
  calibration: Calibration,
): Canonical {
  const asset = source.assets[selectorId];
  if (!asset) throw new Error("selector asset is missing");
  if (hasStandaloneCalibration(calibrationId, source, calibration)) {
    throw new Error("standalone calibration transforms are not supported");
  }
  const document = parseSvg(asset.svg);
  const root = rootOf(document);
  if (elementsOf(root).some((element) => element.getAttribute("id") === motifId)) {
    throw new Error("artwork already uses the reserved id " + motifId);
  }
  fixHtmlAttributeCase(root);
  const tuned = calibrateComposite(document, root, calibrationId, source, calibration);
  if (tuned) tuned.motif.setAttribute("id", motifId);
  const notes: string[] = [];
  if (/<style|\sstyle="/.test(asset.svg))
    notes.push("CSS styles converted to presentation attributes.");
  if (asset.svg.indexOf("<svg", 1) > 0)
    notes.push("Nested SVG viewport kept as authored, with its position and size made explicit.");
  if (/="var\(/.test(asset.svg)) {
    notes.push(
      "CSS var() in presentation attributes resolved to its fallback, as Chromium renders it in the selector.",
    );
  }
  const technical: string[] = [];
  if (root.hasAttribute("width") || root.hasAttribute("height")) {
    technical.push("Root width and height removed; the viewBox sizes the artwork.");
  }
  if (/\s(?:class|role|version|data-[\w-]+|aria-[\w-]+|xml:space)="/.test(asset.svg)) {
    technical.push("Editor and selector bookkeeping attributes removed.");
  }
  if (asset.svg.includes("xlink:href"))
    technical.push("Legacy xlink:href references rewritten as href.");
  resolveStyles(root);
  stripNonRenderingAttributes(root);
  pinNestedViewports(root);
  const svg = serializeSvg(document);
  validateSvg(svg);
  return { svg, factor: tuned?.factor ?? 1, notes, technical, composite: tuned !== null };
}

function calibrationNote(
  calibrationId: string,
  source: SelectorSource,
  calibration: Calibration,
): string {
  const pack = source.meta[calibrationId]?.pack ?? "";
  const config = calibration.overrides[calibrationId] ?? calibration.packs[pack];
  if (!config) return "";
  const scope = calibration.overrides[calibrationId] ? "artwork override" : pack + " pack baseline";
  return (
    "Selector calibration (" +
    scope +
    "): motif size " +
    config.size +
    ", closed " +
    config.x +
    "/" +
    config.y +
    ", open " +
    config.openX +
    "/" +
    config.openY +
    ", stroke " +
    config.stroke +
    "."
  );
}

export async function readReviewRecords(root: string): Promise<ReviewRecords> {
  const selectionsBytes = await readFile(join(root, selectionsPath));
  const calibrationBytes = await readFile(join(root, calibrationPath));
  const selections = JSON.parse(selectionsBytes.toString("utf8")) as unknown;
  if (!isRecord(selections) || selections.schema !== "file-icon-selections-v2") {
    throw new Error(selectionsPath + " is not a file-icon-selections-v2 record");
  }
  if (!isRecord(selections.entries) || !isRecord(selections.globalColor)) {
    throw new Error(selectionsPath + " needs entries and globalColor");
  }
  const color = selections.globalColor;
  const globalColor: GlobalColor = {
    token: text(color, "token") ?? "",
    customLight: text(color, "customLight") ?? "",
    customDark: text(color, "customDark") ?? "",
  };
  const decisions: Record<string, Decision> = {};
  for (const [id, value] of Object.entries(selections.entries)) {
    if (!isRecord(value)) throw new Error(id + " must be an object");
    const kind = value.kind;
    if (kind !== "file" && kind !== "folder") throw new Error(id + " has an invalid kind");
    const alternatives = Array.isArray(value.alternatives) ? value.alternatives : [];
    decisions[id] = {
      kind,
      primary: parsePick(value.primary, id),
      alternatives: alternatives.map((alt, index) => parsePick(alt, id + " alt " + index)),
    };
  }
  return {
    decisions,
    globalColor,
    calibration: JSON.parse(calibrationBytes.toString("utf8")) as unknown,
    selectionsSha256: sha256(selectionsBytes),
    calibrationSha256: sha256(calibrationBytes),
  };
}

function comparable(pick: SelectorPick): string {
  return JSON.stringify([pick.icon, pick.colorMode, pick.hex, pick.stroke, pick.expandedIcon]);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  if (isRecord(value)) {
    return (
      "{" +
      Object.keys(value)
        .sort()
        .map((key) => JSON.stringify(key) + ":" + canonicalJson(value[key]))
        .join(",") +
      "}"
    );
  }
  return JSON.stringify(value);
}

/**
 * The stored review records are authoritative, including the 2026-10-29 visual approvals.
 * The selector HTML is only an artwork source, so its selections must match apart from approval
 * flags, and its calibration must match exactly; otherwise the import stops.
 */
/** A candidate's rights record from any review row: the classification belongs to the artwork. */
function candidateRecord(
  source: SelectorSource,
  rowId: string,
  icon: string,
): JsonRecord | undefined {
  const own = source.rows.get(rowId)?.candidateRights[icon];
  if (own) return own;
  for (const row of source.rows.values()) {
    const record = row.candidateRights[icon];
    if (record) return record;
  }
  return undefined;
}

/**
 * selections.json is the theme's authoritative choice record; the selector HTML is its artwork
 * and calibration library. They must describe the same decisions and the same calibration.
 */
function assertSourcesAgree(records: ReviewRecords, source: SelectorSource): void {
  const problems: string[] = [];
  const seedIds = Object.keys(source.seedSelections).sort();
  const recordIds = Object.keys(records.decisions).sort();
  if (seedIds.join("\n") !== recordIds.join("\n")) problems.push("decision IDs differ");
  if (canonicalJson(source.seedCalibration) !== canonicalJson(records.calibration)) {
    problems.push("calibration differs from the selector seed");
  }
  if (problems.length) {
    throw new Error(
      "Review records and selector disagree; nothing was imported:\n- " +
        problems.slice(0, 20).join("\n- "),
    );
  }
}

async function writeJson(path: string, value: unknown): Promise<void> {
  const formatted = await format(JSON.stringify(value), {
    ...(await resolveConfig(path)),
    parser: "json",
  });
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, formatted);
}

type Artwork = {
  id: string;
  selectorId: string;
  category: Category;
  svg: string;
  metadata: IconMetadata;
  release: ReleaseStatus;
  factor: number;
};

const releaseOrder = { eligible: 0, held: 1 };

function trademarkNote(
  selectorId: string,
  asset: SelectorAsset,
  release: ReleaseStatus,
): string | null {
  const identity = text(asset, "brandIdentity");
  const branded =
    identity !== null ||
    /^(?:owner-pending|simple|brandvar):/.test(selectorId) ||
    /BRAND|OWNER|LOGO|STYLIZED/.test(release.basis);
  if (!branded) return null;
  return (
    (identity ? identity + ": " : "") +
    "third-party mark or brand-associated artwork. Visual approval only; licence and trademark clearance are pending."
  );
}

export type ImportResult = {
  decisions: number;
  artworks: number;
  unavailable: Array<{ id: string; reason: string }>;
};

export async function importSelector(
  selectorPath: string,
  root = projectRoot,
  only: string[] | null = null,
): Promise<ImportResult> {
  const records = await readReviewRecords(root);
  const source = await readSelector(selectorPath);
  assertSourcesAgree(records, source);
  // Hand-authored canonical artwork a pick can use directly as "icon:<id>".
  const handAuthored = new Map(
    (await validateIcons(root)).filter((icon) => !icon.origin).map((icon) => [icon.id, icon]),
  );
  const calibration = hydrateCalibration(records.calibration, source);
  const rights = await loadRights(root);
  const ids = (only ?? Object.keys(records.decisions)).slice().sort();
  for (const id of ids) {
    if (!records.decisions[id]) throw new Error("unknown decision " + id);
  }

  const artworks = new Map<string, Artwork>();
  const failures = new Map<string, string>();

  function promote(
    selectorId: string,
    calibrationId: string,
    selectorRelease: ReleaseStatus,
  ): Artwork {
    const known = failures.get(selectorId);
    if (known) throw new Error(known);
    const id = canonicalArtworkId(selectorId);
    // Audited artwork takes its release status and rights from the register, never the selector.
    const registered = rights.byArtwork.get(id);
    const release = registered
      ? registerRelease(registered.entry, rights.register.audit.date)
      : selectorRelease;
    const existing = artworks.get(id);
    if (existing) {
      if (existing.selectorId !== selectorId)
        throw new Error("artwork ID collision with " + existing.selectorId);
      if (releaseOrder[release.status] > releaseOrder[existing.release.status]) {
        existing.release = release;
        existing.metadata.release = release;
      }
      return existing;
    }
    const asset = source.assets[selectorId];
    if (!asset) throw new Error("selector asset " + selectorId + " is missing");
    try {
      const info = source.meta[calibrationId];
      const composite = info?.mode === "composite" ? { folder: info.folder } : null;
      const category = categoryOf(selectorId, composite);
      const listed = sourcesOf(selectorId, asset, category);
      const sources = registered ? auditedSources(listed, selectorId, registered.entry) : listed;
      if (category !== "symbol" && sources.some((s) => s.library === "simple-icons")) {
        throw new Error(
          "Simple Icons composite: Modern File Icons allows Simple Icons only as standalone marks until owner permission is verified",
        );
      }
      const canonical = canonicalize(selectorId, calibrationId, source, calibration);
      const notes = [...canonical.notes];
      if (canonical.composite) notes.unshift(calibrationNote(calibrationId, source, calibration));
      const metadata: IconMetadata = {
        id,
        name: (text(asset, "sourceName") ?? text(asset, "name") ?? selectorId).replace(
          " (proposed)",
          "",
        ),
        category,
        style: canonical.svg.includes('stroke="currentColor"')
          ? canonical.svg.includes('fill="currentColor"')
            ? "mixed"
            : "outline"
          : "filled",
        sources,
        customization: {
          color: canonical.svg.includes("currentColor"),
          strokeWidth: asset.stroke === true && asset.protectMotif !== true,
        },
      };
      if (notes.length) metadata.modifications = notes.join(" ");
      const trademark = registered?.entry.trademark ?? trademarkNote(selectorId, asset, release);
      if (trademark) metadata.trademark = trademark;
      metadata.origin = {
        seed: source.seedId,
        candidate: selectorId,
        sha256: sha256(canonical.svg + "\n"),
      };
      metadata.release = release;
      if (registered) {
        metadata.rights = artworkRights(registered.decision, registered.entry, [
          ...notes,
          ...canonical.technical,
        ]);
      }
      const artwork: Artwork = {
        id,
        selectorId,
        category,
        svg: canonical.svg,
        metadata,
        release,
        factor: canonical.factor,
      };
      artworks.set(id, artwork);
      return artwork;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      failures.set(selectorId, reason);
      throw new Error(reason);
    }
  }

  const decisions: Record<string, ThemeDecision> = {};
  const unavailable: ImportResult["unavailable"] = [];
  for (const id of ids) {
    const record = records.decisions[id];
    const row = source.rows.get(id);
    if (!record || !row) throw new Error("decision " + id + " is missing from the selector rows");
    const pick = record.primary;
    const paints = modes.map((mode) =>
      paint(row, pick, source.assets[pick.icon], mode, records.globalColor, source.colorOptions),
    );
    const decision: ThemeDecision = {
      kind: record.kind,
      selection: { icon: pick.icon, expandedIcon: pick.expandedIcon },
      color: {
        light: resolvedColor(paints[0] ?? { color: "currentColor", original: true }, "light"),
        dark: resolvedColor(paints[1] ?? { color: "currentColor", original: true }, "dark"),
      },
      visualApproved: pick.visualApproved === true,
    };
    // Canonical Modern File Icons artwork outside the selector library, picked as "icon:<id>".
    if (pick.icon.startsWith("icon:")) {
      for (const ref of [pick.icon, pick.expandedIcon]) {
        if (ref && !handAuthored.has(ref.slice(5))) {
          throw new Error(id + ": " + ref + " must name hand-authored canonical artwork in icons/");
        }
      }
      if (record.kind === "folder" && !pick.expandedIcon?.startsWith("icon:")) {
        throw new Error(id + ": a folder needs closed and open canonical artwork");
      }
      decision.artwork = pick.icon.slice(5);
      if (pick.expandedIcon) decision.expandedArtwork = pick.expandedIcon.slice(5);
      decisions[id] = decision;
      continue;
    }
    try {
      if (paints.some((p) => !p.original) && pick.icon.startsWith("material:")) {
        throw new Error("recoloured Material artwork is not supported by the port");
      }
      for (const mode of modes) {
        for (const state of record.kind === "folder"
          ? (["closed", "open"] as const)
          : (["closed"] as const)) {
          const expected = state === "open" ? pick.expandedIcon : pick.icon;
          if (displayedArtwork(row, pick, state, mode, source.assets) !== expected) {
            throw new Error("light-mode Material artwork variants are not supported by the port");
          }
        }
      }
      if (record.kind === "folder" && !pick.expandedIcon) {
        throw new Error("folder selection has no expanded artwork");
      }
      const rightsRecord = candidateRecord(source, id, pick.icon);
      const rights = releaseStatus(rightsRecord);
      const closed = promote(pick.icon, pick.icon, rights);
      decision.artwork = closed.id;
      if (record.kind === "folder" && pick.expandedIcon) {
        decision.expandedArtwork = promote(pick.expandedIcon, pick.icon, rights).id;
      }
      const asset = source.assets[pick.icon];
      const spec = asset ? strokeSpec(pick, asset, record.kind, closed.factor) : null;
      if (spec) decision.stroke = spec;
      const fixed = asset ? fixedRootSize(asset.svg) : null;
      const openAsset = pick.expandedIcon ? source.assets[pick.expandedIcon] : undefined;
      if (openAsset && fixedRootSize(openAsset.svg) !== fixed) {
        throw new Error("closed and open artwork fix different root sizes");
      }
      if (fixed !== null) decision.fixedSize = fixed;
    } catch (error) {
      delete decision.artwork;
      delete decision.expandedArtwork;
      decision.unavailable = error instanceof Error ? error.message : String(error);
      unavailable.push({ id, reason: decision.unavailable });
    }
    decisions[id] = decision;
  }

  // Pair closed/open folder geometry as variants when both halves were promoted.
  for (const decision of Object.values(decisions)) {
    if (!decision.artwork || !decision.expandedArtwork) continue;
    const closed = artworks.get(decision.artwork);
    const open = artworks.get(decision.expandedArtwork);
    if (closed && open && closed.category === open.category && closed !== open) {
      closed.metadata.variantGroup = closed.id;
      open.metadata.variantGroup = closed.id;
    }
  }

  await writeArtworks(root, artworks, only === null);
  await writeFile(join(root, ownerNoticePath), ownerNotice(rights.register));

  const associations: ThemeAssociations = {
    fileNames: {},
    fileExtensions: {},
    languageIds: {},
    folderNames: {},
  };
  const groups: Record<string, keyof ThemeAssociations> = {
    filenames: "fileNames",
    extensions: "fileExtensions",
    languages: "languageIds",
    folders: "folderNames",
  };
  for (const id of ids) {
    const row = source.rows.get(id);
    for (const [group, keys] of Object.entries(row?.aliases ?? {})) {
      const target = groups[group];
      if (!target) continue;
      for (const key of keys) {
        const previous = associations[target][key];
        if (previous && previous !== id)
          throw new Error("alias " + key + " maps to " + previous + " and " + id);
        associations[target][key] = id;
      }
    }
  }
  for (const map of Object.values(associations)) {
    const sorted = Object.fromEntries(
      Object.entries(map).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
    );
    for (const key of Object.keys(map)) delete map[key];
    Object.assign(map, sorted);
  }

  const theme: ThemeDefinition = {
    id: "modern-file-icons",
    name: "Modern File Icons",
    version: "0.1.0",
    source: {
      selector: { sha256: source.sha256, seedId: source.seedId },
      selections: { path: selectionsPath, sha256: records.selectionsSha256 },
      calibration: { path: calibrationPath, sha256: records.calibrationSha256 },
    },
    fallbacks: { file: "file:file", folder: "folder:folder", rootFolder: "folder:folder-root" },
    decisions,
  };
  await writeJson(join(root, themeDirectory, "theme.json"), theme);
  await writeJson(join(root, themeDirectory, "associations.json"), associations);

  return { decisions: ids.length, artworks: artworks.size, unavailable };
}

const directories: Record<Category, string> = {
  folder: "folders",
  file: "files",
  symbol: "symbols",
};

async function writeArtworks(
  root: string,
  artworks: Map<string, Artwork>,
  pruneStale: boolean,
): Promise<void> {
  const existing = new Map<string, { path: string; imported: boolean }>();
  const paths = [
    ...new Bun.Glob("icons/**/*.json").scanSync({ cwd: root }),
    ...new Bun.Glob(heldIcons + "/**/*.json").scanSync({ cwd: root }),
  ];
  for (const path of paths) {
    const metadata = JSON.parse(await readFile(join(root, path), "utf8")) as unknown;
    if (isRecord(metadata) && typeof metadata.id === "string") {
      existing.set(metadata.id, { path, imported: isRecord(metadata.origin) });
    }
  }
  for (const artwork of artworks.values()) {
    const current = existing.get(artwork.id);
    if (current && !current.imported) {
      throw new Error("refusing to overwrite hand-authored artwork " + artwork.id);
    }
    // Held artwork stays in held/, which public publication excludes.
    const tree = artwork.release.status === "held" ? heldIcons : "icons";
    const base = join(root, tree, directories[artwork.category], artwork.id);
    if (current && current.path !== base.slice(root.length + 1) + ".json") {
      await rm(join(root, current.path));
      await rm(join(root, current.path.replace(/\.json$/, ".svg")), { force: true });
    }
    await mkdir(dirname(base), { recursive: true });
    await writeFile(base + ".svg", artwork.svg + "\n");
    await writeJson(base + ".json", artwork.metadata);
  }
  if (!pruneStale) return;
  for (const [id, current] of existing) {
    if (current.imported && !artworks.has(id)) {
      await rm(join(root, current.path));
      await rm(join(root, current.path.replace(/\.json$/, ".svg")), { force: true });
    }
  }
}

/** Hashes of every file the importer owns: artwork, theme files and the owner notice. */
async function importedFiles(root: string): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  const patterns = [
    "icons/**/*",
    heldIcons + "/**/*",
    "themes/modern-file-icons/theme.json",
    "themes/modern-file-icons/associations.json",
    ownerNoticePath,
  ];
  for (const pattern of patterns) {
    for (const path of new Bun.Glob(pattern).scanSync({ cwd: root })) {
      files.set(path, sha256(await readFile(join(root, path))));
    }
  }
  return files;
}

/**
 * Re-import into a scratch copy and compare every imported file byte for byte. Any difference
 * means the review record, calibration, selector, register or tools drifted from the checkout.
 */
export async function reproduce(selectorPath: string, root = projectRoot): Promise<string[]> {
  const work = await mkdtemp(join(tmpdir(), "mfi-reproduce-"));
  try {
    const skipped = /^\/(?:node_modules|dist|\.git)(?:\/|$)/;
    await cp(root, work, {
      recursive: true,
      filter: (path) => !skipped.test(path.slice(root.length)),
    });
    await symlink(join(root, "node_modules"), join(work, "node_modules"));
    await importSelector(selectorPath, work);
    const expected = await importedFiles(root);
    const actual = await importedFiles(work);
    const paths = [...new Set([...expected.keys(), ...actual.keys()])].sort();
    return paths.filter((path) => expected.get(path) !== actual.get(path));
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const selector = option("--selector");
  if (selector && args.includes("--check")) {
    try {
      const differences = await reproduce(
        resolve(selector),
        resolve(option("--root") ?? projectRoot),
      );
      if (differences.length) {
        console.error(differences.length + " imported files differ from a fresh import:");
        for (const path of differences.slice(0, 40)) console.error("- " + path);
        process.exitCode = 1;
      } else {
        console.log("Reproducible: a fresh import matches every imported file byte for byte.");
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  } else if (!selector) {
    console.error(
      "Usage: bun tools/import-selector.ts --selector <selector.html> [--root <dir>] [--only <id,id>] [--check]",
    );
    process.exitCode = 1;
  } else {
    try {
      const only =
        option("--only")
          ?.split(",")
          .map((id) => id.trim())
          .filter(Boolean) ?? null;
      const result = await importSelector(
        resolve(selector),
        resolve(option("--root") ?? projectRoot),
        only,
      );
      console.log(
        "Imported " +
          result.decisions +
          " decisions and " +
          result.artworks +
          " artworks; " +
          result.unavailable.length +
          " decisions use a fallback.",
      );
      for (const item of result.unavailable) console.log("- " + item.id + ": " + item.reason);
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
