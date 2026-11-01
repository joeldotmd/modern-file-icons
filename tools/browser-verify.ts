/// <reference lib="dom" />
import { chromium, type Page } from "playwright";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

// Browser-level verification: the real v6.12 selector page renders each approved primary with
// its own JavaScript and CSS, and Chromium compares that with the generated SVG drawn the way a
// host must draw it (an <img> enlarged by the bleed with matching negative margins).

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sizes = [18, 24, 96];
const modes = ["light", "dark"] as const;
type Mode = (typeof modes)[number];
type State = "closed" | "open";
// Backgrounds of the selector's light and dark cards.
const backgrounds: Record<Mode, string> = { light: "#ffffff", dark: "#171a20" };
// Same tolerance as the resvg verification: at most 0.1% of pixels may differ by more than 24/255.
const pixelTolerance = 24;
const ratioTolerance = 0.001;
const maxCanvas = 3600;

// The selector defines cell() and art() inside a closure. The verification copy adds one line
// after cell() that exposes them; the rendering code itself is unchanged.
const hookAnchor =
  'function cell(slot,cfg){if(!cfg)return "";return slot.open?art(slot.row,openOf(cfg),cfg,true,cfg.icon):art(slot.row,cfg.icon,cfg,false);}';
const hook = "window.__iconVerify=()=>({cell,INDEX,state,tuneCard:window.__iconTune});";
// tuneCard() (the calibration pass) lives in a separate script scope; expose it the same way.
const tuneAnchor = "function tuneCard(card){";
const tuneHook = "window.__iconTune=(card)=>tuneCard(card);";

type Pick = {
  icon: string;
  colorMode: string;
  hex: string | null;
  stroke: number | null;
  expandedIcon: string | null;
};
type Item = {
  id: string;
  state: State;
  pick: Pick;
  files: Record<Mode, string>;
  fixedSize?: number;
};
export type BrowserCheck = {
  id: string;
  state: State;
  mode: Mode;
  size: number;
  pass: boolean;
  ratio: number;
  maxDelta: number;
  /** The selector drew this artwork at a fixed size instead of the requested one. */
  fixedSize?: number;
  /** First comparison, when it failed and a re-render at another page position passed. */
  firstAttempt?: { ratio: number; maxDelta: number };
  /** Output compared with the selector's own calibrated SVG drawn as an image. */
  imageControl?: { ratio: number; maxDelta: number };
};

/** The selector's tuned SVGs as standalone image sources, framed by the bleed. */
async function selectorImages(page: Page, size: number, pad: number): Promise<string[]> {
  return page.evaluate(
    ({ size, pad }) =>
      [...(document.getElementById("icon-verify")?.children ?? [])].map((slot) => {
        const svg = slot.querySelector(".glyph > svg");
        if (!(svg instanceof SVGSVGElement)) return "";
        const clone = svg.cloneNode(true) as SVGSVGElement;
        clone.style.width = "";
        clone.style.height = "";
        clone.style.color = getComputedStyle(svg).color;
        const box = svg.viewBox.baseVal;
        const side = Math.max(box.width, box.height);
        const bleed = (side * pad) / size;
        const x = box.x + (box.width - side) / 2 - bleed;
        const y = box.y + (box.height - side) / 2 - bleed;
        clone.setAttribute("viewBox", [x, y, side + 2 * bleed, side + 2 * bleed].join(" "));
        clone.setAttribute("width", String(size + 2 * pad));
        clone.setAttribute("height", String(size + 2 * pad));
        return (
          "data:image/svg+xml;charset=utf-8," +
          encodeURIComponent(new XMLSerializer().serializeToString(clone))
        );
      }),
    { size, pad },
  );
}

// Chromium rasterizes inline SVG in page tiles but an <img> as a whole, so anti-aliasing can
// differ by a pixel depending on where an icon lands. A real artwork difference persists at
// every position; a failing check is therefore re-rendered at these page offsets.
const retryOffsets = [37, 71];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function json(path: string): Promise<Record<string, unknown>> {
  const value = JSON.parse(await readFile(path, "utf8")) as unknown;
  if (!isRecord(value)) throw new Error(path + " must contain an object");
  return value;
}

/** Every preview output that renders its own approved selection, with its light/dark files. */
async function itemsFor(
  root: string,
  preview: string,
): Promise<{ items: Item[]; bleed: number; outsideSelector: string[] }> {
  const theme = await json(join(root, "themes/modern-file-icons/theme.json"));
  const selections = await json(join(root, "themes/modern-file-icons/selections.json"));
  const manifest = await json(join(preview, "manifest.json"));
  const definitions = manifest.iconDefinitions;
  const meta = manifest.modernFileIcons;
  if (
    !isRecord(theme.decisions) ||
    !isRecord(selections.entries) ||
    !isRecord(definitions) ||
    !isRecord(meta)
  ) {
    throw new Error("theme, selections or preview manifest is malformed");
  }
  const fixedSizes = isRecord(meta.fixedSizes) ? meta.fixedSizes : {};
  if (meta.profile !== "preview" || typeof meta.bleed !== "number") {
    throw new Error("expected a preview build with a bleed");
  }
  const items: Item[] = [];
  const outsideSelector: string[] = [];
  for (const [id, value] of Object.entries(theme.decisions)) {
    if (!isRecord(value) || typeof value.artwork !== "string") continue;
    const entry = selections.entries[id];
    if (!isRecord(entry) || !isRecord(entry.primary))
      throw new Error(id + " has no recorded selection");
    const primary = entry.primary;
    if (String(primary.icon).startsWith("icon:")) {
      outsideSelector.push(id);
      continue;
    }
    const pick: Pick = {
      icon: String(primary.icon),
      colorMode: String(primary.colorMode),
      hex: typeof primary.hex === "string" ? primary.hex : null,
      stroke: typeof primary.stroke === "number" ? primary.stroke : null,
      expandedIcon: typeof primary.expandedIcon === "string" ? primary.expandedIcon : null,
    };
    const states: State[] = value.kind === "folder" ? ["closed", "open"] : ["closed"];
    for (const state of states) {
      const name = id.slice(id.indexOf(":") + 1) + (state === "open" ? "-open" : "");
      const file = (key: string) => {
        const definition = definitions[key];
        return isRecord(definition) && typeof definition.iconPath === "string"
          ? pathToFileURL(join(preview, definition.iconPath)).href
          : null;
      };
      const dark = file(name);
      if (!dark) throw new Error("preview build has no icon " + name);
      const fixed = fixedSizes[name];
      items.push({
        id,
        state,
        pick,
        files: { dark, light: file(name + "_light") ?? dark },
        ...(typeof fixed === "number" ? { fixedSize: fixed } : {}),
      });
    }
  }
  return { items, bleed: meta.bleed, outsideSelector };
}

async function renderReference(
  page: Page,
  items: Item[],
  size: number,
  pad: number,
  cols: number,
  mode: Mode,
  offset = 0,
): Promise<number[]> {
  return page.evaluate(
    ({ items, size, pad, cols, mode, background, offset }) => {
      const api = (
        window as unknown as { __iconVerify: () => Record<string, unknown> }
      ).__iconVerify();
      const state = api.state as { theme: string };
      const index = api.INDEX as Record<string, unknown>;
      const cell = api.cell as (slot: unknown, cfg: unknown) => string;
      const tune = api.tuneCard as (card: Element) => void;
      state.theme = mode;
      document.documentElement.dataset.theme = mode;
      document.getElementById("icon-verify")?.remove();
      const box = size + 2 * pad;
      const root = document.createElement("div");
      root.id = "icon-verify";
      root.style.cssText = `position:absolute;left:${offset}px;top:${offset}px;z-index:2147483647;background:${background};width:${cols * box}px;height:${Math.ceil(items.length / cols) * box}px`;
      items.forEach((item, i) => {
        const slot = document.createElement("div");
        slot.style.cssText = `position:absolute;left:${(i % cols) * box + pad}px;top:${Math.floor(i / cols) * box + pad}px;width:${size}px;height:${size}px;--s:${size}px`;
        slot.innerHTML = cell({ row: index[item.id], open: item.state === "open" }, item.pick);
        root.appendChild(slot);
      });
      document.body.appendChild(root);
      for (const card of root.querySelectorAll("[data-composite-id]")) tune(card);
      // Rendered width of each artwork's root; some source files fix it with an inline style.
      return [...root.children].map(
        (slot) => slot.querySelector(".glyph > svg")?.getBoundingClientRect().width ?? 0,
      );
    },
    { items, size, pad, cols, mode, background: backgrounds[mode], offset },
  );
}

async function renderOutput(
  page: Page,
  items: Item[],
  size: number,
  pad: number,
  cols: number,
  mode: Mode,
  offset = 0,
): Promise<void> {
  // A host draws each image enlarged by the bleed with negative margins; artwork the selector
  // drew at a fixed size is drawn at that size from the top-left of the layout box.
  const entries = items.map((item) => {
    const drawn = item.fixedSize ?? size;
    const margin = Math.round(((drawn * pad) / size) * 1e9) / 1e9;
    return { source: item.files[mode], image: drawn + 2 * margin, margin };
  });
  await page.evaluate(
    async ({ entries, size, pad, cols, background, offset }) => {
      document.getElementById("icon-verify")?.remove();
      const box = size + 2 * pad;
      const root = document.createElement("div");
      root.id = "icon-verify";
      root.style.cssText = `position:absolute;left:${offset}px;top:${offset}px;background:${background};width:${cols * box}px;height:${Math.ceil(entries.length / cols) * box}px`;
      const images: HTMLImageElement[] = [];
      entries.forEach((entry, i) => {
        const slot = document.createElement("div");
        slot.style.cssText = `position:absolute;left:${(i % cols) * box + pad}px;top:${Math.floor(i / cols) * box + pad}px;width:${size}px;height:${size}px`;
        const image = new Image();
        image.style.cssText = `position:absolute;display:block;left:${-entry.margin}px;top:${-entry.margin}px;width:${entry.image}px;height:${entry.image}px`;
        image.src = entry.source;
        images.push(image);
        slot.appendChild(image);
        root.appendChild(slot);
      });
      document.body.appendChild(root);
      await Promise.all(images.map((image) => image.decode()));
    },
    { entries, size, pad, cols, background: backgrounds[mode], offset },
  );
}

type CellResult = { ratio: number; maxDelta: number; reference?: string; output?: string };

async function compareShots(
  page: Page,
  reference: Buffer,
  output: Buffer,
  count: number,
  cols: number,
  box: number,
): Promise<CellResult[]> {
  return page.evaluate(
    async ({ a, b, count, cols, box, pixelTolerance, ratioTolerance }) => {
      const load = async (base64: string) => {
        const bytes = Uint8Array.from(atob(base64), (c) => c.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no 2d context");
        context.drawImage(bitmap, 0, 0);
        return { canvas, data: context.getImageData(0, 0, bitmap.width, bitmap.height) };
      };
      const [ref, out] = await Promise.all([load(a), load(b)]);
      const crop = async (canvas: OffscreenCanvas, x: number, y: number) => {
        const piece = new OffscreenCanvas(box, box);
        piece.getContext("2d")?.drawImage(canvas, x, y, box, box, 0, 0, box, box);
        const bytes = new Uint8Array(await (await piece.convertToBlob()).arrayBuffer());
        let text = "";
        for (const byte of bytes) text += String.fromCharCode(byte);
        return btoa(text);
      };
      const results = [];
      for (let i = 0; i < count; i += 1) {
        const x0 = (i % cols) * box;
        const y0 = Math.floor(i / cols) * box;
        let different = 0;
        let maxDelta = 0;
        for (let y = y0; y < y0 + box; y += 1) {
          for (let x = x0; x < x0 + box; x += 1) {
            const p = (y * ref.data.width + x) * 4;
            let delta = 0;
            for (let c = 0; c < 4; c += 1) {
              delta = Math.max(
                delta,
                Math.abs((ref.data.data[p + c] ?? 0) - (out.data.data[p + c] ?? 0)),
              );
            }
            maxDelta = Math.max(maxDelta, delta);
            if (delta > pixelTolerance) different += 1;
          }
        }
        const ratio = different / (box * box);
        const result: { ratio: number; maxDelta: number; reference?: string; output?: string } = {
          ratio,
          maxDelta,
        };
        if (ratio > ratioTolerance) {
          result.reference = await crop(ref.canvas, x0, y0);
          result.output = await crop(out.canvas, x0, y0);
        }
        results.push(result);
      }
      return results;
    },
    {
      a: reference.toString("base64"),
      b: output.toString("base64"),
      count,
      cols,
      box,
      pixelTolerance,
      ratioTolerance,
    },
  );
}

export async function verifyInBrowser(
  selectorPath: string,
  root = projectRoot,
  out = join(projectRoot, "dist", "modern-file-icons"),
  only: string[] | null = null,
): Promise<{ checks: BrowserCheck[]; browser: string; outsideSelector: string[] }> {
  const preview = join(out, "preview");
  const loaded = await itemsFor(root, preview);
  const items = only ? loaded.items.filter((item) => only.includes(item.id)) : loaded.items;
  const work = await mkdtemp(join(tmpdir(), "mfi-browser-"));
  const diffs = join(out, "browser", "diffs");
  await rm(join(out, "browser"), { recursive: true, force: true });
  await mkdir(diffs, { recursive: true });
  try {
    const bytes = await readFile(selectorPath);
    const theme = await json(join(root, "themes/modern-file-icons/theme.json"));
    const recorded =
      isRecord(theme.source) && isRecord(theme.source.selector)
        ? theme.source.selector.sha256
        : null;
    if (createHash("sha256").update(bytes).digest("hex") !== recorded) {
      throw new Error(
        "selector HTML is not the one theme.json was imported from; refusing to verify",
      );
    }
    const html = bytes.toString("utf8");
    if (html.split(hookAnchor).length !== 2 || html.split(tuneAnchor).length !== 2) {
      throw new Error("selector cell() or tuneCard() not found exactly once; is this v6.12?");
    }
    const selectorCopy = join(work, "selector.html");
    await writeFile(
      selectorCopy,
      html.replace(hookAnchor, hookAnchor + hook).replace(tuneAnchor, tuneHook + tuneAnchor),
    );
    const harness = join(work, "harness.html");
    await writeFile(
      harness,
      "<!doctype html><html><head><style>html,body{margin:0;padding:0}</style></head><body></body></html>",
    );

    const browser = await chromium.launch();
    const checks: BrowserCheck[] = [];
    try {
      const context = await browser.newContext({
        viewport: { width: maxCanvas, height: maxCanvas },
        deviceScaleFactor: 1,
      });
      const selectorPage = await context.newPage();
      await selectorPage.goto(pathToFileURL(selectorCopy).href, {
        waitUntil: "load",
        timeout: 120_000,
      });
      await selectorPage.waitForFunction(
        () => "__iconVerify" in window && "__iconTune" in window,
        null,
        { timeout: 120_000 },
      );
      const harnessPage = await context.newPage();
      await harnessPage.goto(pathToFileURL(harness).href);
      for (const mode of modes) {
        await selectorPage.emulateMedia({ colorScheme: mode });
        for (const size of sizes) {
          const pad = Math.round(size * loaded.bleed * 1e9) / 1e9;
          if (!Number.isInteger(pad))
            throw new Error("bleed does not give whole pixels at " + size + " px");
          const box = size + 2 * pad;
          const cols = Math.floor(maxCanvas / box);
          const chunk = cols * Math.floor(maxCanvas / box);
          for (let start = 0; start < items.length; start += chunk) {
            const batch = items.slice(start, start + chunk);
            const drawn = await renderReference(selectorPage, batch, size, pad, cols, mode);
            await renderOutput(harnessPage, batch, size, pad, cols, mode);
            const reference = await selectorPage
              .locator("#icon-verify")
              .screenshot({ animations: "disabled" });
            const output = await harnessPage
              .locator("#icon-verify")
              .screenshot({ animations: "disabled" });
            const results = await compareShots(
              harnessPage,
              reference,
              output,
              batch.length,
              cols,
              box,
            );
            const firsts = new Map<number, CellResult>();
            for (const offset of retryOffsets) {
              const retry = results
                .map((result, i) => ({ result, i }))
                .filter(
                  ({ result, i }) =>
                    result.ratio > ratioTolerance &&
                    Math.abs((drawn[i] ?? size) - (batch[i]?.fixedSize ?? size)) <= 0.5,
                );
              if (!retry.length) break;
              const subset = retry.map(({ i }) => batch[i] as Item);
              await renderReference(selectorPage, subset, size, pad, cols, mode, offset);
              await renderOutput(harnessPage, subset, size, pad, cols, mode, offset);
              const again = await compareShots(
                harnessPage,
                await selectorPage.locator("#icon-verify").screenshot({ animations: "disabled" }),
                await harnessPage.locator("#icon-verify").screenshot({ animations: "disabled" }),
                subset.length,
                cols,
                box,
              );
              retry.forEach(({ result, i }, k) => {
                const second = again[k];
                if (!second) return;
                if (!firsts.has(i)) firsts.set(i, result);
                if (second.ratio <= ratioTolerance)
                  results[i] = { ratio: second.ratio, maxDelta: second.maxDelta };
                else if (offset === retryOffsets[retryOffsets.length - 1])
                  results[i] = { ...second, reference: result.reference, output: result.output };
              });
            }
            // Control: for checks still failing, draw the selector's own calibrated SVG as an image
            // and compare it with the output. A match means only Chromium's inline-versus-image
            // rendering differs, not the artwork.
            const controls = new Map<number, { ratio: number; maxDelta: number }>();
            const failing = results
              .map((result, i) => ({ result, i }))
              .filter(
                ({ result, i }) =>
                  result.ratio > ratioTolerance &&
                  Math.abs((drawn[i] ?? size) - (batch[i]?.fixedSize ?? size)) <= 0.5,
              );
            if (failing.length) {
              const subset = failing.map(({ i }) => batch[i] as Item);
              await renderReference(selectorPage, subset, size, pad, cols, mode);
              const images = await selectorImages(selectorPage, size, pad);
              await renderOutput(
                harnessPage,
                subset.map((item, k) => ({
                  ...item,
                  files: { light: images[k] ?? "", dark: images[k] ?? "" },
                })),
                size,
                pad,
                cols,
                mode,
              );
              const selectorShot = await harnessPage
                .locator("#icon-verify")
                .screenshot({ animations: "disabled" });
              await renderOutput(harnessPage, subset, size, pad, cols, mode);
              const outputShot = await harnessPage
                .locator("#icon-verify")
                .screenshot({ animations: "disabled" });
              const compared = await compareShots(
                harnessPage,
                selectorShot,
                outputShot,
                subset.length,
                cols,
                box,
              );
              failing.forEach(({ i }, k) => {
                const result = compared[k];
                if (result) controls.set(i, { ratio: result.ratio, maxDelta: result.maxDelta });
              });
            }
            for (const [i, result] of results.entries()) {
              const item = batch[i];
              if (!item) continue;
              const pass = result.ratio <= ratioTolerance;
              const check: BrowserCheck = {
                id: item.id,
                state: item.state,
                mode,
                size,
                pass,
                ratio: result.ratio,
                maxDelta: result.maxDelta,
              };
              const width = drawn[i] ?? size;
              // The selector must draw what the theme declares: the cell size or the fixed size.
              if (Math.abs(width - (item.fixedSize ?? size)) > 0.5) {
                check.fixedSize = width;
                check.pass = false;
              }
              const first = firsts.get(i);
              if (first && pass)
                check.firstAttempt = { ratio: first.ratio, maxDelta: first.maxDelta };
              const control = controls.get(i);
              if (control && !pass) check.imageControl = control;
              checks.push(check);
              if (!pass && result.reference && result.output) {
                const stem = join(
                  diffs,
                  [item.id.replace(":", "_"), item.state, mode, size].join("_"),
                );
                await writeFile(stem + "_selector.png", Buffer.from(result.reference, "base64"));
                await writeFile(stem + "_output.png", Buffer.from(result.output, "base64"));
              }
            }
          }
        }
      }
      return {
        checks,
        browser: "Chromium " + browser.version(),
        outsideSelector: loaded.outsideSelector,
      };
    } finally {
      await browser.close();
    }
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

function browserReport(
  checks: BrowserCheck[],
  browser: string,
  selector: string,
  outsideSelector: string[] = [],
): string {
  const renderer = checks.filter(
    (check) =>
      !check.pass && check.imageControl !== undefined && check.imageControl.ratio <= ratioTolerance,
  );
  const failed = checks.filter((check) => !check.pass && !renderer.includes(check));
  const fixed = checks.filter((check) => check.fixedSize !== undefined);
  const retried = checks.filter((check) => check.firstAttempt !== undefined);
  const decisions = new Set(checks.map((check) => check.id));
  const failedDecisions = new Set(failed.map((check) => check.id));
  const worst = checks.reduce((max, check) => Math.max(max, check.maxDelta), 0);
  const lines = [
    "# Modern File Icons browser verification",
    "",
    browser +
      " renders the v6.12 selector page itself (`" +
      selector +
      "`, its own JavaScript and CSS, with one line exposing its cell() function) and the generated preview SVGs as host images enlarged by the bleed. Each approved primary is compared in light and dark, closed and open, at " +
      sizes.join(", ") +
      " px. A check passes when at most " +
      ratioTolerance * 100 +
      "% of pixels differ by more than " +
      pixelTolerance +
      "/255.",
    "",
    "| Measure | Value |",
    "| --- | ---: |",
    "| Decisions checked | " + decisions.size + " |",
    "| Checks | " + checks.length + " |",
    "| Failed checks | " + failed.length + " |",
    "| Decisions with a failure | " + failedDecisions.size + " |",
    "| Largest channel difference | " + worst + "/255 |",
    "| Checks where the drawn size differs from the declared size | " + fixed.length + " |",
    "| Checks that passed only at another page position | " + retried.length + " |",
    "| Checks matching the selector's own SVG drawn as an image | " + renderer.length + " |",
    "",
    "Not compared (canonical artwork outside the selector library, so there is no selector rendering): " +
      (outsideSelector.length ? outsideSelector.map((id) => "`" + id + "`").join(", ") : "none") +
      ".",
    "",
    "## Failures",
    "",
    ...(failed.length
      ? failed.map(
          (c) =>
            "- `" +
            c.id +
            "` " +
            c.state +
            "/" +
            c.mode +
            "/" +
            c.size +
            "px: " +
            (c.ratio * 100).toFixed(2) +
            "% pixels, max delta " +
            c.maxDelta,
        )
      : ["None."]),
    "",
    "## Passed only when re-rendered at another page position",
    "",
    "Chromium anti-aliases inline SVG per page tile, so these differed at one grid position and matched at another. A real artwork difference fails at every position.",
    "",
    ...(retried.length
      ? retried.map(
          (c) =>
            "- `" +
            c.id +
            "` " +
            c.state +
            "/" +
            c.mode +
            "/" +
            c.size +
            "px: first " +
            ((c.firstAttempt?.ratio ?? 0) * 100).toFixed(2) +
            "% pixels (max delta " +
            (c.firstAttempt?.maxDelta ?? 0) +
            "), then " +
            (c.ratio * 100).toFixed(2) +
            "% (max delta " +
            c.maxDelta +
            ")",
        )
      : ["None."]),
    "",
    "## Matches the selector's own artwork drawn as an image",
    "",
    "These differ from the selector's inline rendering at every page position, yet match the selector's own calibrated SVG when Chromium draws it as an image, as hosts do. The artwork is identical; only Chromium's inline and image rendering paths differ.",
    "",
    ...(renderer.length
      ? renderer.map(
          (c) =>
            "- `" +
            c.id +
            "` " +
            c.state +
            "/" +
            c.mode +
            "/" +
            c.size +
            "px: inline " +
            (c.ratio * 100).toFixed(2) +
            "% (max delta " +
            c.maxDelta +
            "); against the selector SVG as an image " +
            ((c.imageControl?.ratio ?? 0) * 100).toFixed(2) +
            "% (max delta " +
            (c.imageControl?.maxDelta ?? 0) +
            ")",
        )
      : ["None."]),
    "",
    "## Drawn size differs from the declared size",
    "",
    "The selector drew these at a size other than the one the theme declares (the cell size, or `modernFileIcons.fixedSizes`). They also count as failures above.",
    "",
    ...(fixed.length
      ? fixed.map(
          (c) =>
            "- `" +
            c.id +
            "` " +
            c.state +
            "/" +
            c.mode +
            "/" +
            c.size +
            "px: selector drew " +
            c.fixedSize +
            " px; " +
            (c.ratio * 100).toFixed(2) +
            "% pixels differ",
        )
      : ["None."]),
    "",
  ];
  return lines.join("\n");
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const option = (name: string) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
  };
  const selector = option("--selector");
  if (!selector) {
    console.error(
      "Usage: bun tools/browser-verify.ts --selector <selector.html> [--out <dist dir>] [--only <id,id>]",
    );
    process.exitCode = 1;
  } else {
    try {
      const out = resolve(option("--out") ?? join(projectRoot, "dist", "modern-file-icons"));
      const only =
        option("--only")
          ?.split(",")
          .map((id) => id.trim())
          .filter(Boolean) ?? null;
      const { checks, browser, outsideSelector } = await verifyInBrowser(
        resolve(selector),
        projectRoot,
        out,
        only,
      );
      const report = browserReport(
        checks,
        browser,
        selector.split("/").at(-1) ?? selector,
        outsideSelector,
      );
      await writeFile(join(out, "browser", "report.md"), report);
      await writeFile(
        join(out, "browser", "report.json"),
        JSON.stringify({ browser, checks }, null, 2) + "\n",
      );
      const failed = checks.filter(
        (check) =>
          !check.pass && !(check.imageControl && check.imageControl.ratio <= ratioTolerance),
      );
      const fixedCount = checks.filter((check) => check.fixedSize !== undefined).length;
      console.log(
        browser +
          ": " +
          checks.length +
          " checks, " +
          failed.length +
          " failed, " +
          fixedCount +
          " size mismatches. Wrote " +
          join(out, "browser"),
      );
      if (failed.length) process.exitCode = 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
