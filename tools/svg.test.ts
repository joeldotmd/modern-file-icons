import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DOMParser } from "@xmldom/xmldom";
import { maxSvgBytes, validateSvg } from "./svg.ts";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const opening = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">';
const closing = "</svg>";

test("accepts the existing canonical SVG artwork", async () => {
  const paths = [...new Bun.Glob("icons/**/*.svg").scanSync({ cwd: root })];
  expect(paths.length).toBeGreaterThan(0);
  for (const file of paths) {
    const svg = await readFile(join(root, file), "utf8");
    expect(() => validateSvg(svg)).not.toThrow();
  }
});

test.each([
  ["non-XML", "THIS IS NOT SVG"],
  ["truncated XML", opening + "<path d='M0 0'></svg"],
  ["missing namespace", '<svg viewBox="0 0 24 24"><path d="M0 0"/></svg>'],
  ["missing viewBox", '<svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0"/></svg>'],
  ["scripts", opening + "<script>alert(1)</script>" + closing],
  ["event handlers", opening + '<path d="M0 0" onload="alert(1)"/>' + closing],
  ["external images", opening + '<image href="https://example.com/a.svg"/>' + closing],
  ["linked resources", opening + '<use href="https://example.com/a.svg#x"/>' + closing],
  ["foreignObject", opening + "<foreignObject><div>Hi</div></foreignObject>" + closing],
  ["CSS styles", opening + '<path d="M0 0" style="fill:url(https://example.com/a)"/>' + closing],
  ["URL paints", opening + '<path d="M0 0" fill="url(https://example.com/a)"/>' + closing],
  ["namespace injection", opening + '<g xmlns:xlink="http://www.w3.org/1999/xlink"/>' + closing],
  ["DOCTYPE", '<!DOCTYPE svg [<!ENTITY attack "hello">]>' + opening + closing],
  ["processing instruction", opening + "<?attack test?>" + closing],
  ["unrecognized SVG tags", opening + "<animate attributeName='opacity'/>" + closing],
  ["path command injection", opening + '<path d="M0 0;alert(1)"/>' + closing],
  ["non-numeric widths", opening + '<g stroke-width="abc"/>' + closing],
  ["invalid viewBox", '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 0 24"/>'],
])("rejects %s", (_case, svg) => {
  expect(() => validateSvg(svg)).toThrow();
});

test("rejects an oversized SVG before XML parsing", () => {
  expect(() => validateSvg(opening + " ".repeat(maxSvgBytes) + closing)).toThrow("KiB");
});

test("preserves the approved lighter secondary stroke geometry", async () => {
  for (const path of [
    "icons/folders/folder-link.svg",
    "icons/folders/folder-star.svg",
    "icons/files/file-react.svg",
  ]) {
    const svg = await readFile(join(root, path), "utf8");
    const doc = new DOMParser().parseFromString(svg, "application/xml");
    const baseWidth = Number(doc.documentElement?.getAttribute("stroke-width"));
    const secondary = doc.getElementsByTagName("g").item(0);
    expect(secondary).not.toBeNull();
    const stroke = Number(secondary?.getAttribute("stroke-width"));
    const scale = Number(secondary?.getAttribute("transform")?.match(/scale\(([\d.]+)\)/)?.[1]);
    const ratio = (stroke * scale) / baseWidth;
    expect(ratio).toBeGreaterThan(0.75);
    expect(ratio).toBeLessThan(0.9);
  }
});
