import { DOMParser, XMLSerializer, type Document, type Element } from "@xmldom/xmldom";

export const svgNamespace = "http://www.w3.org/2000/svg";

/** Parse untrusted SVG text as strict XML; malformed input throws. */
export function parseSvg(source: string): Document {
  return new DOMParser({
    onError: (_level, message) => {
      throw new Error(message);
    },
  }).parseFromString(source, "image/svg+xml");
}

export function serializeSvg(document: Document): string {
  return new XMLSerializer().serializeToString(document);
}

export function rootOf(document: Document): Element {
  const root = document.documentElement;
  if (!root || root.localName !== "svg") throw new Error("expected an SVG root element");
  return root;
}

/** Depth-first list of an element and all of its element descendants. */
export function elementsOf(root: Element): Element[] {
  const result: Element[] = [];
  const visit = (element: Element): void => {
    result.push(element);
    for (let child = element.firstChild; child; child = child.nextSibling) {
      if (child.nodeType === 1) visit(child as Element);
    }
  };
  visit(root);
  return result;
}

export function childElements(element: Element): Element[] {
  const result: Element[] = [];
  for (let child = element.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === 1) result.push(child as Element);
  }
  return result;
}

// Twelve significant digits remove float noise without moving pixel-aligned edges.
export function formatNumber(value: number): string {
  const rounded = Number(value.toPrecision(12));
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

// The selector inserted artwork with innerHTML, so the HTML parser corrected these attribute names.
const htmlAttributeCase: Record<string, string> = {
  viewbox: "viewBox",
  preserveaspectratio: "preserveAspectRatio",
  gradientunits: "gradientUnits",
  gradienttransform: "gradientTransform",
  clippathunits: "clipPathUnits",
  maskunits: "maskUnits",
  maskcontentunits: "maskContentUnits",
  filterunits: "filterUnits",
  primitiveunits: "primitiveUnits",
  stddeviation: "stdDeviation",
  spreadmethod: "spreadMethod",
};

export function fixHtmlAttributeCase(root: Element): void {
  for (const element of elementsOf(root)) {
    for (const attribute of [...attributeNames(element)]) {
      const fixed = htmlAttributeCase[attribute.toLowerCase()];
      if (fixed && fixed !== attribute) {
        const value = element.getAttribute(attribute) ?? "";
        element.removeAttribute(attribute);
        if (!element.hasAttribute(fixed)) element.setAttribute(fixed, value);
      }
    }
  }
}

function attributeNames(element: Element): string[] {
  const names: string[] = [];
  for (let i = 0; i < element.attributes.length; i += 1) {
    const attribute = element.attributes.item(i);
    if (attribute) names.push(attribute.name);
  }
  return names;
}

// CSS properties that map one-to-one onto validated SVG presentation attributes.
const presentationProperties = new Set([
  "fill",
  "fill-opacity",
  "fill-rule",
  "stroke",
  "stroke-width",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-opacity",
  "opacity",
  "stop-color",
  "stop-opacity",
  "display",
  "visibility",
  "color",
  "clip-rule",
  "clip-path",
  "mask",
  "filter",
  "color-interpolation-filters",
  "flood-color",
  "flood-opacity",
  "paint-order",
  "shape-rendering",
  "overflow",
]);

/** Properties with no visual effect on these icons, when they hold the given values. */
function ignorable(property: string, value: string): boolean {
  switch (property) {
    case "enable-background":
    case "solid-color":
    case "solid-opacity":
    case "color-rendering":
    case "image-rendering":
    case "text-rendering":
      return true;
    case "color-interpolation":
      return value === "auto" || value === "sRGB";
    case "isolation":
      return value === "auto";
    case "mix-blend-mode":
      return value === "normal";
    case "marker":
    case "marker-start":
    case "marker-mid":
    case "marker-end":
      return value === "none";
    default:
      return false;
  }
}

function normalizeValue(property: string, raw: string): string {
  let value = raw.replace(/!important\s*$/i, "").trim();
  // Custom properties are not defined for icons, so a CSS var() resolves to its fallback.
  const variable = /^var\(\s*--[\w-]+\s*(?:,\s*([^()]+))?\)$/.exec(value);
  if (variable) {
    if (variable[1] === undefined) throw new Error("CSS var() without a fallback in " + property);
    value = variable[1].trim();
  }
  value = value.replace(/url\(\s*["']?(#[^"')]+)["']?\s*\)/g, "url($1)");
  if (/^(?:stroke-width|stroke-miterlimit|stroke-dashoffset)$/.test(property)) {
    value = value.replace(/^([+-]?(?:\d+(?:\.\d*)?|\.\d+))px$/, "$1");
  }
  if (property === "stroke-dasharray") value = value.replace(/px/g, "");
  if (property === "display") value = value === "none" ? "none" : "inline";
  return value;
}

function parseDeclarations(text: string, element: string): Array<[string, string]> {
  const declarations: Array<[string, string]> = [];
  for (const part of text.split(";")) {
    if (!part.trim()) continue;
    const colon = part.indexOf(":");
    if (colon < 0) throw new Error("malformed CSS declaration: " + part.trim());
    const property = part.slice(0, colon).trim().toLowerCase();
    const value = normalizeValue(property, part.slice(colon + 1));
    if (property.startsWith("-")) continue; // editor vendor metadata such as -inkscape-*
    if ((property === "width" || property === "height") && element === "svg") continue;
    if (ignorable(property, value)) continue;
    if (property === "transform") {
      declarations.push([property, value === "none" ? "none" : cssTransform(value)]);
      continue;
    }
    if (!presentationProperties.has(property)) {
      throw new Error("unsupported CSS property " + property + ": " + value);
    }
    declarations.push([property, value]);
  }
  return declarations;
}

/**
 * Convert a CSS transform on an SVG element to the transform attribute. With the default
 * transform-origin for SVG elements (0 0) both mean the same; px are user units.
 */
function cssTransform(value: string): string {
  const parts: string[] = [];
  const pattern = /([a-zA-Z]+)\(([^)]*)\)/g;
  let consumed = 0;
  for (let match = pattern.exec(value); match; match = pattern.exec(value)) {
    if (value.slice(consumed, match.index).trim())
      throw new Error("unsupported CSS transform " + value);
    consumed = match.index + match[0].length;
    const args = (match[2] ?? "")
      .split(/[\s,]+/)
      .filter(Boolean)
      .map((arg) => {
        const number = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))(px|deg)?$/.exec(arg);
        if (!number) throw new Error("unsupported CSS transform value " + arg);
        return number[1] ?? "0";
      });
    const [a = "0", b] = args;
    switch (match[1]) {
      case "translate":
        parts.push("translate(" + a + " " + (b ?? "0") + ")");
        break;
      case "translateX":
        parts.push("translate(" + a + " 0)");
        break;
      case "translateY":
        parts.push("translate(0 " + a + ")");
        break;
      case "scale":
        parts.push("scale(" + a + " " + (b ?? a) + ")");
        break;
      case "rotate":
        parts.push("rotate(" + a + ")");
        break;
      case "matrix":
        if (args.length !== 6) throw new Error("unsupported CSS transform " + value);
        parts.push("matrix(" + args.join(" ") + ")");
        break;
      default:
        throw new Error("unsupported CSS transform " + value);
    }
  }
  if (!parts.length || value.slice(consumed).trim())
    throw new Error("unsupported CSS transform " + value);
  return parts.join(" ");
}

type Compound = { tag?: string; id?: string; classes: string[] };
type Rule = {
  compounds: Compound[];
  specificity: number;
  order: number;
  declarations: Array<[string, string]>;
};

function parseSelector(text: string): Compound[] {
  return text
    .trim()
    .split(/\s+/)
    .map((part) => {
      const match = /^([a-zA-Z][\w-]*)?((?:[#.][A-Za-z_][\w-]*)*)$/.exec(part);
      if (!match || (!match[1] && !match[2])) throw new Error("unsupported CSS selector " + text);
      const compound: Compound = { classes: [] };
      if (match[1]) compound.tag = match[1];
      for (const token of match[2]?.match(/[#.][A-Za-z_][\w-]*/g) ?? []) {
        if (token.startsWith("#")) {
          if (compound.id) throw new Error("unsupported CSS selector " + text);
          compound.id = token.slice(1);
        } else compound.classes.push(token.slice(1));
      }
      return compound;
    });
}

function compoundMatches(element: Element, compound: Compound): boolean {
  if (compound.tag && element.localName !== compound.tag) return false;
  if (compound.id && element.getAttribute("id") !== compound.id) return false;
  const classes = (element.getAttribute("class") ?? "").split(/\s+/);
  return compound.classes.every((name) => classes.includes(name));
}

function selectorMatches(element: Element, compounds: Compound[]): boolean {
  const last = compounds[compounds.length - 1];
  if (!last || !compoundMatches(element, last)) return false;
  let index = compounds.length - 2;
  let ancestor = element.parentNode;
  while (index >= 0 && ancestor && ancestor.nodeType === 1) {
    const compound = compounds[index];
    if (compound && compoundMatches(ancestor as Element, compound)) index -= 1;
    ancestor = ancestor.parentNode;
  }
  return index < 0;
}

function parseStylesheet(css: string, firstOrder: number): Rule[] {
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  if (text.includes("@")) throw new Error("unsupported CSS at-rule");
  const rules: Rule[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  let consumed = 0;
  let order = firstOrder;
  for (let match = pattern.exec(text); match; match = pattern.exec(text)) {
    if (text.slice(consumed, match.index).trim()) throw new Error("malformed CSS stylesheet");
    consumed = match.index + match[0].length;
    for (const selector of (match[1] ?? "").split(",")) {
      const compounds = parseSelector(selector);
      const ids = compounds.filter((c) => c.id).length;
      const classes = compounds.reduce((n, c) => n + c.classes.length, 0);
      const tags = compounds.filter((c) => c.tag).length;
      rules.push({
        compounds,
        specificity: ids * 10000 + classes * 100 + tags,
        order: order++,
        declarations: parseDeclarations(match[2] ?? "", ""),
      });
    }
  }
  if (text.slice(consumed).trim()) throw new Error("malformed CSS stylesheet");
  return rules;
}

/**
 * Convert <style> rules and inline style attributes into presentation attributes using CSS
 * precedence (inline style, then stylesheet specificity and order, then existing attributes).
 */
export function resolveStyles(root: Element): void {
  const styleElements = elementsOf(root).filter((element) => element.localName === "style");
  const rules: Rule[] = [];
  for (const style of styleElements) {
    rules.push(...parseStylesheet(style.textContent ?? "", rules.length));
  }
  for (const element of elementsOf(root)) {
    if (element.localName === "style") continue;
    const matched = rules
      .filter((rule) => selectorMatches(element, rule.compounds))
      .sort((a, b) => a.specificity - b.specificity || a.order - b.order);
    const values = new Map<string, string>();
    for (const rule of matched)
      for (const [key, value] of rule.declarations) values.set(key, value);
    const inline = element.getAttribute("style");
    if (inline !== null) {
      for (const [key, value] of parseDeclarations(inline, element.localName ?? "")) {
        values.set(key, value);
      }
      element.removeAttribute("style");
    }
    for (const [key, value] of values) {
      if (key === "transform" && value === "none") element.removeAttribute(key);
      else element.setAttribute(key, value);
    }
  }
  for (const style of styleElements) style.parentNode?.removeChild(style);
}

// Attributes that carry editor, accessibility, or selector bookkeeping rather than artwork.
function isNonRenderingAttribute(name: string): boolean {
  return (
    name === "class" ||
    name === "role" ||
    name === "version" ||
    name.startsWith("data-") ||
    name.startsWith("aria-") ||
    name.startsWith("xml:") ||
    (name.startsWith("xmlns:") && name !== "xmlns")
  );
}

const lengthAttributes = new Set([
  "x",
  "y",
  "width",
  "height",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "x1",
  "y1",
  "x2",
  "y2",
  "fx",
  "fy",
  "stroke-width",
  "stroke-dashoffset",
]);

/** The fallback of a lone var(--name, fallback), or null when there is none. */
export function resolveVariable(value: string): string | null {
  const match = /^\s*var\(\s*--[\w-]+\s*,\s*([^()]+?)\s*\)\s*$/.exec(value);
  return match?.[1] ?? null;
}

/** Remove bookkeeping attributes and replace legacy xlink:href with href. */
export function stripNonRenderingAttributes(root: Element): void {
  for (const element of elementsOf(root)) {
    const legacy = element.getAttribute("xlink:href");
    if (legacy !== null) {
      element.removeAttribute("xlink:href");
      if (!element.hasAttribute("href")) element.setAttribute("href", legacy);
    }
    for (const name of attributeNames(element)) {
      if (isNonRenderingAttribute(name)) {
        element.removeAttribute(name);
        continue;
      }
      const value = element.getAttribute(name) ?? "";
      // Chromium resolves var() in presentation attributes; icons define no custom properties,
      // so the fallback applies. Without a fallback the attribute is invalid and ignored.
      if (value.includes("var(")) {
        const fallback = resolveVariable(value);
        if (fallback === null) element.removeAttribute(name);
        else element.setAttribute(name, fallback);
        continue;
      }
      // In SVG, px lengths are user units; the unit adds nothing.
      const px = /^\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?)px\s*$/.exec(value);
      if (px && lengthAttributes.has(name)) element.setAttribute(name, px[1] ?? "0");
      // A paint fallback after a local reference is unused when the reference exists.
      const paint = /^(url\(#[^)]+\))\s+\S+$/.exec(value);
      if (paint && (name === "fill" || name === "stroke"))
        element.setAttribute(name, paint[1] ?? "");
    }
    if (element !== root && element.localName !== "svg") element.removeAttribute("overflow");
  }
  for (const name of ["width", "height", "x", "y", "overflow"]) {
    root.removeAttribute(name);
  }
}

function length(value: string | null, reference: number, fallback: number): number {
  if (value === null || value === "") return fallback;
  const percent = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+))%$/.exec(value.trim());
  if (percent) return (Number(percent[1]) / 100) * reference;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error("unsupported nested SVG length " + value);
  return parsed;
}

function viewBoxOf(element: Element): [number, number, number, number] | null {
  const raw = element.getAttribute("viewBox");
  if (raw === null) return null;
  const values = raw
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (values.length !== 4 || values.some((v) => !Number.isFinite(v))) {
    throw new Error("invalid nested SVG viewBox " + raw);
  }
  return [values[0] ?? 0, values[1] ?? 0, values[2] ?? 0, values[3] ?? 0];
}

/**
 * Keep nested <svg> viewports exactly as authored (their viewBox, preserveAspectRatio and clip),
 * so browsers map and clip them as they did in the selector. Only a missing or percentage
 * position or size is pinned to numbers, because framing the root for the bleed would otherwise
 * change what 100% means.
 */
export function pinNestedViewports(root: Element): void {
  const rootBox = viewBoxOf(root);
  if (!rootBox) throw new Error("root SVG viewBox is required");
  for (const svg of elementsOf(root)) {
    if (svg === root || svg.localName !== "svg") continue;
    if (svg.hasAttribute("transform")) throw new Error("transformed nested SVG is unsupported");
    // A repeated SVG namespace declaration on a nested viewport is redundant.
    if (svg.getAttribute("xmlns") === svgNamespace) svg.removeAttribute("xmlns");
    if (svg.parentNode !== root) {
      const sized = ["x", "y", "width", "height"].every((name) => {
        const value = svg.getAttribute(name);
        return value === null ? name === "x" || name === "y" : !value.endsWith("%");
      });
      if (!sized) throw new Error("deeply nested SVG needs an explicit size");
      continue;
    }
    for (const [name, reference, fallback] of [
      ["x", rootBox[2], 0],
      ["y", rootBox[3], 0],
      ["width", rootBox[2], rootBox[2]],
      ["height", rootBox[3], rootBox[3]],
    ] as const) {
      svg.setAttribute(name, formatNumber(length(svg.getAttribute(name), reference, fallback)));
    }
  }
}
