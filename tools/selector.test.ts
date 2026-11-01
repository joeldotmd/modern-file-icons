import { expect, test } from "bun:test";
import { canonicalArtworkId, kebab } from "./import-selector.ts";
import {
  calibrateComposite,
  fixedRootSize,
  hydrateCalibration,
  paint,
  releaseStatus,
  strokeSpec,
  strokeSvg,
  type CalibrationValues,
  type SelectorAsset,
  type SelectorPick,
  type SelectorRow,
} from "./selector.ts";
import { parseSvg, rootOf, serializeSvg } from "./svg-normalize.ts";

const lucide: CalibrationValues = {
  size: 11.5,
  x: 11.3,
  y: 10.7,
  openX: 11.2,
  openY: 12,
  stroke: 2.5,
};
const source = {
  defaults: { lucide },
  meta: {
    "matched-folder:lucide_Code:closed": { mode: "composite", pack: "lucide", folder: true },
  },
};
const pick = (fields: Partial<SelectorPick>): SelectorPick => ({
  icon: "lucide:Code",
  colorMode: "material",
  hex: null,
  stroke: null,
  expandedIcon: null,
  ...fields,
});
const row: SelectorRow = {
  id: "file:code",
  kind: "file",
  aliases: {},
  representativeColor: "#4caf50",
  materialId: "material:code",
  lightMaterialId: null,
  candidateRights: {},
};
const composite =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">' +
  '<path d="M2 2h10"/><svg width="11.5" height="11.5" x="11.3" y="10.7" viewBox="0 0 24 24" stroke-width="2.5">' +
  '<path d="M4 4h16"/></svg></svg>';

test("calibration clamps stored values onto the selector defaults", () => {
  const calibration = hydrateCalibration(
    {
      packs: { lucide: { size: 13.44, stroke: 9 } },
      overrides: { "matched-folder:lucide_Code:closed": { x: 2 } },
    },
    source,
  );
  expect(calibration.packs.lucide).toEqual({ ...lucide, size: 13.4, stroke: 4.5 });
  expect(calibration.overrides["matched-folder:lucide_Code:closed"]).toMatchObject({
    x: 5,
    size: 13.4,
  });
});

test("composite calibration moves the motif and scales its stroke like the selector", () => {
  const calibration = hydrateCalibration(
    { packs: { lucide: { ...lucide, size: 13.4, x: 13, stroke: 3 } } },
    source,
  );
  const document = parseSvg(composite);
  const result = calibrateComposite(
    document,
    rootOf(document),
    "matched-folder:lucide_Code:closed",
    source,
    calibration,
  );
  expect(result?.factor).toBeCloseTo(3 / 2.5);
  const svg = serializeSvg(document);
  expect(svg).toContain('width="13.4" height="13.4" x="13" y="10.7"');
  expect(svg).toContain('viewBox="0 0 24 24" stroke-width="3"');
  // Open folders have two outline paths, which selects the open coordinates.
  const open = parseSvg(composite.replace("<path", '<path d="M0 0"/><path'));
  calibrateComposite(open, rootOf(open), "matched-folder:lucide_Code:closed", source, calibration);
  expect(serializeSvg(open)).toContain('x="11.2" y="12"');
});

test("pick strokes follow the selector, including widths copied onto a motif", () => {
  const asset = {
    svg: composite.replace(' stroke-width="2.5"', ""),
    pack: "matched-folder",
    stroke: true,
  } as SelectorAsset;
  const stroked = strokeSvg(asset.svg, pick({ stroke: 1 }), asset, "folder");
  expect(stroked).toContain(
    '<path d="M2 2h10"/><svg width="11.5" height="11.5" x="11.3" y="10.7" viewBox="0 0 24 24" stroke-width="1.333">',
  );
  expect(strokeSpec(pick({ stroke: 1 }), asset, "folder", 1.2)).toEqual({
    scope: "motif",
    scale: 1 / 1.5,
    motifWidth: 1.6,
  });
  const standalone = {
    svg: '<svg stroke-width="2"><path/></svg>',
    pack: "lucide",
    stroke: true,
  } as SelectorAsset;
  expect(strokeSvg(standalone.svg, pick({ stroke: 1.5 }), standalone, "file")).toContain(
    'stroke-width="1.5"',
  );
  expect(strokeSpec(pick({ stroke: 1.5 }), standalone, "file", 1)).toEqual({
    scope: "all",
    scale: 0.75,
  });
});

test("paint resolves colour modes per appearance", () => {
  const options = { "primary-text": { light: "#242424", dark: "#F0F0F0" } };
  const global = { token: "custom", customLight: "#8491A5", customDark: "#8491A5" };
  const asset = { svg: "", pack: "lucide" } as SelectorAsset;
  expect(paint(row, pick({}), asset, "dark", global, options).color).toBe("#4caf50");
  expect(paint(row, pick({ colorMode: "foreground" }), asset, "light", global, options).color).toBe(
    "#242424",
  );
  expect(paint(row, pick({ colorMode: "native" }), asset, "dark", global, options).color).toBe(
    "#8491A5",
  );
  const owner = { svg: "", pack: "owner-artwork", brandHex: "#00ADD8" } as SelectorAsset;
  expect(paint(row, pick({ colorMode: "custom" }), owner, "light", global, options)).toEqual({
    color: "#00ADD8",
    original: true,
  });
});

test("release gate holds anything branded, conditional, contradictory or unverified", () => {
  const generic = {
    action: "USE WITH NOTICES",
    usagePermission: "GENERIC LICENSED MOTIF",
    kind: "GENERIC",
  };
  expect(releaseStatus(generic).status).toBe("eligible");
  expect(releaseStatus({ ...generic, action: "USE WITH ATTRIBUTION" }).status).toBe("eligible");
  expect(releaseStatus({ ...generic, action: "USE WITH CONDITIONS" }).status).toBe("held");
  expect(releaseStatus({ ...generic, standalone: "DO NOT SHIP" }).status).toBe("held");
  expect(releaseStatus({ ...generic, sourceVerified: false }).status).toBe("held");
  expect(releaseStatus({ ...generic, usagePermission: "STANDALONE LOGO" }).status).toBe("held");
  expect(releaseStatus(undefined).status).toBe("held");
});

test("selector candidates map to stable canonical artwork IDs", () => {
  expect(kebab("Typescript02")).toBe("typescript-02");
  expect(canonicalArtworkId("huge:FileTextIcon")).toBe("huge-file-text");
  expect(canonicalArtworkId("matched-folder:lucide_CodeXml:open")).toBe(
    "folder-lucide-code-xml-open",
  );
  expect(canonicalArtworkId("matched-folder:phosphor-semantic_Books_regular:closed")).toBe(
    "folder-phosphor-books",
  );
  expect(canonicalArtworkId("owner-pending:go:folder:closed")).toBe("folder-owner-go");
  expect(canonicalArtworkId("brandvar:simple-icons:css")).toBe("simple-icons-css");
  expect(canonicalArtworkId("proposal:folder-androidlogo-phosphor-fill-closed")).toBe(
    "folder-androidlogo-phosphor-fill",
  );
  expect(() => canonicalArtworkId("unknown:thing")).toThrow();
});

test("an inline root size is read as the fixed size the selector drew", () => {
  expect(
    fixedRootSize('<svg style="color:currentColor;width:24px;height:24px" viewBox="0 0 24 24"/>'),
  ).toBe(24);
  expect(fixedRootSize('<svg viewBox="0 0 24 24" width="24" height="24"/>')).toBeNull();
  expect(() => fixedRootSize('<svg style="width:24px;height:2em"/>')).toThrow();
});
