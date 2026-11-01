import { Resvg } from "@resvg/resvg-js";
import { expect, test } from "bun:test";
import {
  parseSvg,
  pinNestedViewports,
  resolveStyles,
  rootOf,
  serializeSvg,
  stripNonRenderingAttributes,
} from "./svg-normalize.ts";
import { validateSvg } from "./svg.ts";

const ns = 'xmlns="http://www.w3.org/2000/svg"';

function normalize(source: string): string {
  const document = parseSvg(source);
  const root = rootOf(document);
  resolveStyles(root);
  stripNonRenderingAttributes(root);
  pinNestedViewports(root);
  return serializeSvg(document);
}

function pixels(svg: string, size = 96): Buffer {
  const document = parseSvg(svg);
  const root = rootOf(document);
  root.setAttribute("width", String(size));
  root.setAttribute("height", String(size));
  return Buffer.from(new Resvg(serializeSvg(document)).render().pixels);
}

// Largest per-channel difference; the theme verification allows anti-aliasing up to 24/255.
function maxDelta(a: Buffer, b: Buffer): number {
  let delta = a.length === b.length ? 0 : 255;
  for (let i = 0; i < Math.min(a.length, b.length); i += 1) {
    delta = Math.max(delta, Math.abs((a[i] ?? 0) - (b[i] ?? 0)));
  }
  return delta;
}

test("stylesheet rules and inline styles become attributes with CSS precedence", () => {
  const svg = normalize(
    `<svg ${ns} viewBox="0 0 24 24"><style>#r .a{fill:#f00}.a{fill:#0f0;stroke-width:2px}</style>` +
      `<path class="a" fill="#00f" d="M0 0h4v4z"/><path class="a" style="fill:#000" d="M5 5h4v4z"/></svg>`,
  );
  expect(svg).not.toContain("<style");
  expect(svg).not.toContain("class=");
  expect(svg).toMatch(/<path fill="#0f0" d="M0 0h4v4z" stroke-width="2"\/>/);
  expect(svg).toMatch(/<path d="M5 5h4v4z" fill="#000" stroke-width="2"\/>/);
  expect(() => validateSvg(svg)).not.toThrow();
});

test("CSS transforms and var() fallbacks convert to browser-equivalent attributes", () => {
  const svg = normalize(
    `<svg ${ns} viewBox="0 0 24 24"><style>#g{transform:translateY(5px)}</style>` +
      `<g id="g"><path d="M0 0h4v4z" style="fill:var(--c, #123456)" stroke-width="var(--w, 3)"/></g></svg>`,
  );
  expect(svg).toContain('transform="translate(0 5)"');
  expect(svg).toContain('fill="#123456"');
  // Chromium resolves var() fallbacks in presentation attributes as well as in CSS.
  expect(svg).toContain('stroke-width="3"');
  expect(svg).not.toContain("var(");
});

test("unsupported CSS fails instead of silently changing artwork", () => {
  const source = `<svg ${ns} viewBox="0 0 24 24"><path style="mix-blend-mode:multiply" d="M0 0h4v4z"/></svg>`;
  expect(() => normalize(source)).toThrow("unsupported CSS property");
});

test("legacy xlink:href and px lengths are normalized", () => {
  const svg = normalize(
    `<svg ${ns} xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 24 24"><defs>` +
      `<linearGradient id="a"><stop offset="0" stop-color="#000"/></linearGradient>` +
      `<linearGradient id="b" xlink:href="#a"/></defs><rect width="10px" height="10" fill="url(#b) none"/></svg>`,
  );
  expect(svg).toContain('href="#a"');
  expect(svg).toContain('width="10"');
  expect(svg).toContain('fill="url(#b)"');
  expect(() => validateSvg(svg)).not.toThrow();
});

test.each([
  ["meet", 'viewBox="0 0 256 256" width="12.9" height="12.9" x="11.6" y="10.8"'],
  ["non-square meet", 'viewBox="0 -15 356 400"'],
  ["none", 'viewBox="0 0 20 10" width="10" height="10" x="2" y="3" preserveAspectRatio="none"'],
])("pinning a nested viewport (%s) keeps it and renders identically", (_case, attributes) => {
  const source =
    `<svg ${ns} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">` +
    `<path d="M2 2h10v10H2z"/><svg ${attributes} fill="#c00" stroke="none">` +
    `<path d="M-20 -20h400v20h-400z M10 10h200v200H10z"/></svg></svg>`;
  const flattened = normalize(source);
  const nested = parseSvg(flattened).getElementsByTagName("svg").item(1);
  expect(nested?.getAttribute("viewBox")).toBeTruthy();
  for (const name of ["x", "y", "width", "height"]) {
    expect(Number.isFinite(Number(nested?.getAttribute(name) ?? "x"))).toBe(true);
  }
  expect(() => validateSvg(flattened)).not.toThrow();
  for (const size of [18, 24, 96]) {
    expect(maxDelta(pixels(flattened, size), pixels(source, size))).toBeLessThanOrEqual(24);
  }
});
