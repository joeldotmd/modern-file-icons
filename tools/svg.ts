import { DOMParser, type Element, type Node } from "@xmldom/xmldom";

const svgNamespace = "http://www.w3.org/2000/svg";

// Owner artwork with embedded raster logos needs more room than vector-only icons.
export const maxSvgBytes = 512 * 1024;

const allowedElements = new Set([
  "svg",
  "g",
  "path",
  "circle",
  "ellipse",
  "rect",
  "line",
  "polyline",
  "polygon",
  "title",
  "desc",
  "defs",
  "linearGradient",
  "radialGradient",
  "stop",
  "clipPath",
  "mask",
  "use",
  "image",
  "filter",
  "feBlend",
  "feColorMatrix",
  "feComposite",
  "feFlood",
  "feGaussianBlur",
  "feMerge",
  "feMergeNode",
  "feOffset",
]);

const numericAttributes = new Set([
  "width",
  "height",
  "stroke-width",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-dashoffset",
  "fill-opacity",
  "stop-opacity",
  "flood-opacity",
  "opacity",
  "cx",
  "cy",
  "r",
  "rx",
  "ry",
  "fx",
  "fy",
  "fr",
  "x",
  "y",
  "x1",
  "y1",
  "x2",
  "y2",
  "dx",
  "dy",
  "k1",
  "k2",
  "k3",
  "k4",
]);
const nonNegativeAttributes = new Set([
  "width",
  "height",
  "stroke-width",
  "stroke-miterlimit",
  "r",
  "rx",
  "ry",
  "fr",
]);
const unitIntervalAttributes = new Set([
  "opacity",
  "stroke-opacity",
  "fill-opacity",
  "stop-opacity",
  "flood-opacity",
]);
const paintAttributes = new Set(["fill", "stroke"]);
const regionElements = new Set(["filter", "mask", "use"]);
const regionAttributes = new Set(["x", "y", "width", "height"]);
const colorAttributes = new Set(["color", "stop-color", "flood-color"]);
const referenceAttributes = new Set(["clip-path", "mask", "filter"]);
const units = ["userSpaceOnUse", "objectBoundingBox"];
const enumerations: Record<string, readonly string[]> = {
  "stroke-linecap": ["butt", "round", "square"],
  "stroke-linejoin": ["arcs", "bevel", "miter", "miter-clip", "round"],
  "fill-rule": ["nonzero", "evenodd"],
  "clip-rule": ["nonzero", "evenodd"],
  display: ["inline", "none"],
  visibility: ["visible", "hidden", "collapse"],
  "shape-rendering": ["auto", "optimizeSpeed", "crispEdges", "geometricPrecision"],
  "color-interpolation-filters": ["auto", "sRGB", "linearRGB"],
  gradientUnits: units,
  clipPathUnits: units,
  maskUnits: units,
  maskContentUnits: units,
  filterUnits: units,
  primitiveUnits: units,
  spreadMethod: ["pad", "reflect", "repeat"],
  mode: ["normal", "multiply", "screen", "overlay", "darken", "lighten"],
  operator: ["over", "in", "out", "atop", "xor", "arithmetic"],
  type: ["matrix", "saturate", "hueRotate", "luminanceToAlpha"],
  "aria-hidden": ["true", "false"],
};
const allowedAttributes = new Set([
  "xmlns",
  "viewBox",
  "preserveAspectRatio",
  "role",
  "aria-label",
  "id",
  "transform",
  "gradientTransform",
  "d",
  "points",
  "offset",
  "stroke-dasharray",
  "paint-order",
  "stdDeviation",
  "values",
  "in",
  "in2",
  "result",
  "href",
  ...numericAttributes,
  ...paintAttributes,
  ...colorAttributes,
  ...referenceAttributes,
  ...Object.keys(enumerations),
]);

const number = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[Ee][+-]?\d+)?$/;
const numberList = /^[+-]?(?:\d|\.\d)[0-9Ee+\-.,\s]*$/;
const pathData = /^[AaCcEeHhLlMmQqSsTtVvZz0-9.,+\-\s]+$/;
const identifier = /^[A-Za-z_][A-Za-z0-9_.-]*$/;
const localReference = /^url\(#([A-Za-z_][A-Za-z0-9_.-]*)\)$/;
const color =
  /^(?:currentColor|transparent|#[a-fA-F0-9]{3,4}|#[a-fA-F0-9]{6}|#[a-fA-F0-9]{8}|[a-zA-Z]+|rgba?\(\s*[0-9.]+%?\s*,\s*[0-9.]+%?\s*,\s*[0-9.]+%?\s*(?:,\s*[0-9.]+%?\s*)?\))$/;
const transforms =
  /^(?:(?:matrix|translate|scale|rotate|skewX|skewY)\s*\(\s*[0-9Ee+\-.,\s]+\)\s*,?\s*)+$/;
const filterInput =
  /^(?:SourceGraphic|SourceAlpha|BackgroundImage|BackgroundAlpha|FillPaint|StrokePaint|[A-Za-z_][A-Za-z0-9_.-]*)$/;
const rasterDataUri = /^data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=\s]+$/;
const aspectRatio = /^(?:none|x(?:Min|Mid|Max)Y(?:Min|Mid|Max))(?:\s+(?:meet|slice))?$/;
const paintOrder = /^(?:normal|(?:fill|stroke|markers)(?:\s+(?:fill|stroke|markers)){0,2})$/;

function validNumber(value: string): boolean {
  return number.test(value) && Number.isFinite(Number(value));
}

/** Returns the local id referenced by an attribute, or null when the value references nothing. */
function checkAttribute(
  element: string,
  name: string,
  value: string,
  isRoot: boolean,
): string | null {
  if (!allowedAttributes.has(name)) {
    throw new Error("disallowed SVG attribute " + name);
  }
  if (name === "xmlns") {
    if (!isRoot || value !== svgNamespace) throw new Error("invalid SVG namespace declaration");
    return null;
  }
  if (name === "viewBox") {
    const values = value.trim().split(/[\s,]+/);
    if (
      (!isRoot && element !== "svg") ||
      values.length !== 4 ||
      !values.every((part) => validNumber(part)) ||
      Number(values[2]) <= 0 ||
      Number(values[3]) <= 0
    ) {
      throw new Error("invalid SVG viewBox");
    }
    return null;
  }
  if (name === "id") {
    if (!identifier.test(value)) throw new Error("invalid SVG id");
    return null;
  }
  if (name === "href") {
    if (element === "use" || element === "linearGradient" || element === "radialGradient") {
      const match = /^#([A-Za-z_][A-Za-z0-9_.-]*)$/.exec(value);
      if (!match) throw new Error(element + " href must reference a local element");
      return match[1] ?? null;
    }
    if (element === "image") {
      if (!rasterDataUri.test(value)) {
        throw new Error("image href must be an embedded PNG, JPEG, GIF, or WebP data URI");
      }
      return null;
    }
    throw new Error("href is only allowed on use, gradients and image");
  }
  if (paintAttributes.has(name)) {
    const reference = localReference.exec(value);
    if (reference) return reference[1] ?? null;
    if (value !== "none" && !color.test(value)) {
      throw new Error("invalid SVG paint value for " + name);
    }
    return null;
  }
  if (colorAttributes.has(name)) {
    if (!color.test(value)) throw new Error("invalid SVG color value for " + name);
    return null;
  }
  if (referenceAttributes.has(name)) {
    if (value === "none") return null;
    const reference = localReference.exec(value);
    if (!reference) throw new Error(name + " must reference a local element");
    return reference[1] ?? null;
  }
  if (name === "transform" || name === "gradientTransform") {
    if (!transforms.test(value)) throw new Error("unsupported SVG transform");
    return null;
  }
  if (name === "d") {
    if (!pathData.test(value) || !/[AaCcHhLlMmQqSsTtVvZz]/.test(value)) {
      throw new Error("invalid SVG path data");
    }
    return null;
  }
  if (name === "points" || name === "values" || name === "stdDeviation") {
    if (!numberList.test(value.trim())) throw new Error("invalid SVG " + name);
    return null;
  }
  if (name === "stroke-dasharray") {
    if (value !== "none" && !numberList.test(value.trim())) {
      throw new Error("invalid SVG stroke-dasharray");
    }
    return null;
  }
  if (name === "offset") {
    const percent = value.endsWith("%");
    const amount = percent ? value.slice(0, -1) : value;
    if (!validNumber(amount)) throw new Error("invalid SVG gradient offset");
    return null;
  }
  if (name === "in" || name === "in2" || name === "result") {
    if (!filterInput.test(value)) throw new Error("invalid SVG filter reference " + name);
    return null;
  }
  if (name === "preserveAspectRatio") {
    if (!aspectRatio.test(value.trim())) throw new Error("invalid SVG preserveAspectRatio");
    return null;
  }
  if (name === "paint-order") {
    if (!paintOrder.test(value.trim())) throw new Error("invalid SVG paint-order");
    return null;
  }
  const allowed = enumerations[name];
  if (allowed) {
    if (!allowed.includes(value)) throw new Error("invalid SVG " + name);
    return null;
  }
  // Percentages are relative to the element's own box only for these regions, so framing an
  // icon with a bleed cannot change their meaning. Shapes must use numbers.
  if (regionElements.has(element) && regionAttributes.has(name) && value.endsWith("%")) {
    if (!validNumber(value.slice(0, -1))) throw new Error("invalid SVG percentage " + name);
    return null;
  }
  if (numericAttributes.has(name)) {
    if (!validNumber(value)) throw new Error("invalid SVG numeric attribute " + name);
    if (nonNegativeAttributes.has(name) && Number(value) < 0) {
      throw new Error("negative SVG dimension " + name);
    }
    if (unitIntervalAttributes.has(name) && (Number(value) < 0 || Number(value) > 1)) {
      throw new Error("SVG opacity must be between 0 and 1");
    }
  }
  return null;
}

/**
 * Validate the self-contained SVG vocabulary allowed for source artwork and theme outputs.
 * Unsupported features are errors; sanitizing and rewriting belong to the importer, never here.
 * References must stay inside the document, and the only embedded resources are raster data URIs.
 */
export function validateSvg(source: string): void {
  if (Buffer.byteLength(source, "utf8") > maxSvgBytes) {
    throw new Error("SVG exceeds the " + maxSvgBytes / 1024 + " KiB source limit");
  }
  if (/<!DOCTYPE\b|<!ENTITY\b|<\?/i.test(source)) {
    throw new Error("SVG document types, entities, and processing instructions are disallowed");
  }

  const document = new DOMParser({
    onError: (_level, message) => {
      throw new Error(message);
    },
  }).parseFromString(source, "application/xml");
  const root = document.documentElement;
  if (!root || root.nodeName !== "svg" || root.namespaceURI !== svgNamespace) {
    throw new Error("expected an SVG root with the SVG namespace");
  }
  if (root.getAttribute("viewBox") === null) {
    throw new Error("SVG viewBox is required");
  }

  const ids = new Set<string>();
  const references = new Set<string>();
  let elementCount = 0;
  function inspect(node: Node): void {
    if (node.nodeType === 1) {
      const element = node as Element;
      elementCount += 1;
      if (elementCount > 2000) throw new Error("SVG contains too many elements");
      if (
        element.namespaceURI !== svgNamespace ||
        element.nodeName !== element.localName ||
        !allowedElements.has(element.nodeName)
      ) {
        throw new Error("disallowed SVG element " + element.nodeName);
      }
      if (element.nodeName === "image" && element.getAttribute("href") === null) {
        throw new Error("image requires an embedded data URI");
      }
      for (let i = 0; i < element.attributes.length; i += 1) {
        const attribute = element.attributes.item(i);
        if (!attribute || attribute.name !== attribute.localName) {
          throw new Error("disallowed namespaced SVG attribute");
        }
        if (attribute.name === "id") {
          if (ids.has(attribute.value)) throw new Error("duplicate SVG id " + attribute.value);
          ids.add(attribute.value);
        }
        const reference = checkAttribute(
          element.nodeName,
          attribute.name,
          attribute.value,
          element === root,
        );
        if (reference) references.add(reference);
      }
    } else if (node.nodeType === 3) {
      if (node.parentNode?.nodeName !== "title" && node.parentNode?.nodeName !== "desc") {
        if (node.nodeValue?.trim()) throw new Error("unexpected SVG text content");
      }
    } else if (node.nodeType !== 8 && node.nodeType !== 9) {
      throw new Error("disallowed SVG node type");
    }

    for (let child = node.firstChild; child; child = child.nextSibling) inspect(child);
  }
  inspect(document);

  for (const reference of references) {
    if (!ids.has(reference)) throw new Error("SVG references missing element #" + reference);
  }
}
