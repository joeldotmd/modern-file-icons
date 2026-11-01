import Ajv from "ajv";
import { readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { IconMetadata } from "./icon-metadata.generated.ts";
import { validateIcons } from "./icons.ts";
import type { RightsRegister, RightsDecision } from "./theme.generated.ts";

// The rights register records the evidence-based assessment of brand and owner artwork. It is
// the only source for that artwork's licence, credit and release status: audited artwork stays
// held, and kept in held/ out of public publication, until a distribution approval exists.

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const rightsPath = "themes/modern-file-icons/rights.json";
export const heldIcons = "held/icons";
export const ownerNoticePath = "licenses/owner-artwork.md";

export type IconRights = NonNullable<IconMetadata["rights"]>;
export type Release = NonNullable<IconMetadata["release"]>;
export type Rights = {
  register: RightsRegister;
  byArtwork: Map<string, { decision: string; entry: RightsDecision }>;
};

async function exists(path: string): Promise<boolean> {
  return stat(path).then(
    () => true,
    () => false,
  );
}

export async function loadRights(root = projectRoot): Promise<Rights> {
  const schema = JSON.parse(
    await readFile(join(root, "schemas", "rights.schema.json"), "utf8"),
  ) as object;
  const validate = new Ajv({ allErrors: true, strict: true }).compile<RightsRegister>(schema);
  const data = JSON.parse(await readFile(join(root, rightsPath), "utf8")) as unknown;
  if (!validate(data)) {
    const messages = (validate.errors ?? []).map(
      (e) => rightsPath + e.instancePath + ": " + e.message,
    );
    throw new Error("Rights register is invalid:\n- " + messages.join("\n- "));
  }
  const errors: string[] = [];
  const byArtwork: Rights["byArtwork"] = new Map();
  for (const [decision, entry] of Object.entries(data.decisions)) {
    const retired = entry.excluded !== undefined;
    if (retired && entry.artworks.length) {
      errors.push(decision + ": excluded or replaced decisions have no artwork");
    }
    if (!retired && !entry.artworks.length) errors.push(decision + ": lists no artwork");
    if (entry.approval && entry.unresolved?.length) {
      errors.push(
        decision + ": approved decisions carry no open questions; keep them in the private audit",
      );
    }
    if (!entry.approval && entry.assessment !== "PERMITTED" && !entry.unresolved?.length) {
      errors.push(decision + ": " + entry.assessment + " needs its unresolved items recorded");
    }
    if (entry.approval && !["PERMITTED", "CONDITIONAL"].includes(entry.assessment)) {
      errors.push(decision + ": a " + entry.assessment + " decision cannot be approved");
    }
    // Every approved artwork ships in the public source and in theme packages.
    for (const form of ["source", "package"] as const) {
      const status = entry.forms[form];
      if (entry.approval && status !== "PERMITTED" && status !== "CONDITIONAL") {
        errors.push(
          decision + ": cannot approve distribution while its " + form + " form is " + status,
        );
      }
    }
    if (!(await exists(join(root, entry.copyright.licenseText)))) {
      errors.push(decision + ": missing licence text " + entry.copyright.licenseText);
    }
    for (const artwork of entry.artworks) {
      const other = byArtwork.get(artwork);
      if (other)
        errors.push(artwork + ": registered under both " + other.decision + " and " + decision);
      byArtwork.set(artwork, { decision, entry });
    }
  }
  if (errors.length) throw new Error("Rights register is invalid:\n- " + errors.join("\n- "));
  return { register: data, byArtwork };
}

/** Obligations a licence attaches to each copy of the artwork. */
export function obligations(license: string): { shareAlike: boolean; noDerivatives: boolean } {
  return { shareAlike: /^CC-BY-SA-/.test(license), noDerivatives: /^CC-BY-ND-/.test(license) };
}

/**
 * Release status of audited artwork: held unless the register records a distribution approval,
 * which covers publishing the artwork in icons/ and shipping it in theme packages.
 */
export function registerRelease(entry: RightsDecision, date: string): Release {
  if (entry.approval) {
    return {
      status: "eligible",
      basis:
        "Approved for distribution in source and theme packages on " + entry.approval.date + ".",
    };
  }
  const open = entry.unresolved?.length ?? 0;
  return {
    status: "held",
    basis:
      "Rights audit " +
      date +
      ": " +
      entry.assessment +
      (open ? "; " + open + " unresolved item" + (open === 1 ? "" : "s") : "") +
      ". Held until a distribution approval is recorded.",
  };
}

/** The per-file rights block for audited artwork, including its full change notice. */
export function artworkRights(
  decision: string,
  entry: RightsDecision,
  changes: string[],
): IconRights {
  const rights: IconRights = {
    decision,
    assessment: entry.assessment,
    license: entry.copyright.license,
    licenseText: entry.copyright.licenseText,
    credit: entry.copyright.credit,
    changes:
      [entry.changes, ...changes].filter(Boolean).join(" ") ||
      "Unmodified artwork in Modern File Icons' self-contained SVG format.",
    ...obligations(entry.copyright.license),
  };
  if (entry.copyright.notice) rights.notice = entry.copyright.notice;
  if (entry.unresolved?.length) rights.unresolved = entry.unresolved;
  if (entry.sources[0]) rights.source = entry.sources[0];
  return rights;
}

/** Public notices: required artwork terms, not internal review history. */
export function ownerNotice(register: RightsRegister): string {
  const lines = [
    "# Owner and brand artwork notices",
    "",
    "Generated from `" +
      rightsPath +
      "`. Regenerate with `bun run rights:generate`; do not edit by hand.",
    "",
    "Copyright, attribution, modification notices and applicable usage conditions for included third-party artwork. Third-party names and logos belong to their owners; their presence does not imply affiliation or endorsement. Applicable rights-holder restrictions remain in force.",
    "",
  ];
  for (const [decision, entry] of Object.entries(register.decisions)) {
    if (registerRelease(entry, register.audit.date).status !== "eligible") continue;
    lines.push("## " + decision + " (" + entry.owner + ")", "");
    if (entry.artworks.length)
      lines.push("- Artwork: " + entry.artworks.map((id) => "`" + id + "`").join(", "));
    lines.push(
      "- Copyright: " + entry.copyright.license + ", `" + entry.copyright.licenseText + "`",
    );
    lines.push("- Credit: " + entry.copyright.credit);
    if (entry.copyright.notice) lines.push("- Notice: " + entry.copyright.notice);
    if (entry.trademark) lines.push("- Trademark: " + entry.trademark);
    if (entry.changes) lines.push("- Changes: " + entry.changes);
    for (const condition of entry.conditions)
      lines.push("- Condition: " + condition.replace(/\s+/g, " "));
    for (const url of entry.sources) lines.push("- Source: " + url);
    for (const url of entry.policies) lines.push("- Policy: " + url);
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Check that artwork metadata, placement and notices agree with the register. In a public-safe
 * checkout (no held/), audited artwork is simply absent; it must never appear under icons/.
 */
export async function checkRights(root = projectRoot): Promise<{ held: number; absent: number }> {
  const rights = await loadRights(root);
  const errors: string[] = [];
  const publicIcons = await validateIcons(root, "icons");
  const heldIconsList = (await exists(join(root, heldIcons)))
    ? await validateIcons(root, heldIcons)
    : [];
  const date = rights.register.audit.date;

  for (const icon of publicIcons) {
    const registered = rights.byArtwork.get(icon.id);
    if (registered && registerRelease(registered.entry, date).status !== "eligible") {
      errors.push(
        icon.id + ": audited artwork without a release approval must live in held/, not icons/",
      );
    }
    if (icon.release?.status === "held")
      errors.push(icon.id + ": held artwork must live in held/, not icons/");
  }
  for (const icon of [...publicIcons, ...heldIconsList]) {
    const registered = rights.byArtwork.get(icon.id);
    if (!registered) {
      if (icon.release?.status === "held")
        errors.push(icon.id + ": held artwork has no rights register entry");
      if (icon.rights) errors.push(icon.id + ": rights metadata without a register entry");
      continue;
    }
    const { decision, entry } = registered;
    const expected = registerRelease(entry, date);
    if (icon.release?.status !== expected.status || icon.release.basis !== expected.basis) {
      errors.push(icon.id + ": release metadata is out of date with the register");
    }
    const r = icon.rights;
    if (
      !r ||
      r.decision !== decision ||
      r.assessment !== entry.assessment ||
      r.license !== entry.copyright.license ||
      r.licenseText !== entry.copyright.licenseText ||
      r.credit !== entry.copyright.credit ||
      r.notice !== entry.copyright.notice ||
      JSON.stringify(r.unresolved ?? []) !== JSON.stringify(entry.unresolved ?? []) ||
      r.source !== entry.sources[0] ||
      (entry.changes !== undefined && !r.changes.startsWith(entry.changes))
    ) {
      errors.push(
        icon.id + ": rights metadata is out of date with the register; re-run theme:import",
      );
    }
    for (const source of icon.sources) {
      if (source.library === "owner-artwork" || source.library === "simple-icons") {
        if (source.license !== entry.copyright.licenseText) {
          errors.push(
            icon.id + ": " + source.library + " source must cite " + entry.copyright.licenseText,
          );
        }
      }
      if (
        source.library === "@mdi/svg" &&
        /^language-/.test(source.icon) &&
        source.license !== "licenses/mdi-brand-icons.md"
      ) {
        errors.push(
          icon.id +
            ": MDI brand icons are outside the MDI Apache-2.0 grant; cite licenses/mdi-brand-icons.md",
        );
      }
    }
  }
  for (const icon of heldIconsList) {
    if (icon.release?.status !== "held")
      errors.push(icon.id + ": only held artwork belongs in held/");
  }

  const present = new Set([...publicIcons, ...heldIconsList].map((icon) => icon.id));
  const absent = [...rights.byArtwork.keys()].filter((id) => !present.has(id));
  if (heldIconsList.length && absent.length) {
    errors.push("audited artwork missing from held/: " + absent.join(", "));
  }
  // Files under ShareAlike or NoDerivatives licences are exceptions to the project's MIT licence.
  const exceptions = await readFile(join(root, "THIRD-PARTY-NOTICES.md"), "utf8").catch(() => "");
  for (const icon of [...publicIcons, ...heldIconsList]) {
    if (
      (icon.rights?.shareAlike || icon.rights?.noDerivatives) &&
      !exceptions.includes("/" + icon.id + ".svg`")
    ) {
      errors.push(
        icon.id +
          ": THIRD-PARTY-NOTICES.md must list this " +
          icon.rights.license +
          " file as an exception to MIT",
      );
    }
  }
  const notice = await readFile(join(root, ownerNoticePath), "utf8").catch(() => "");
  if (notice !== ownerNotice(rights.register)) {
    errors.push(ownerNoticePath + " is out of date with the register; re-run theme:import");
  }
  if (errors.length) throw new Error("Rights check failed:\n- " + errors.join("\n- "));
  return { held: heldIconsList.length, absent: absent.length };
}

if (import.meta.main) {
  const action = process.argv[2];
  if (action !== "check" && action !== "generate") {
    console.error("Usage: bun tools/rights.ts <check|generate>");
    process.exitCode = 1;
  } else {
    try {
      if (action === "generate") {
        const { register } = await loadRights();
        await writeFile(join(projectRoot, ownerNoticePath), ownerNotice(register));
        console.log("Generated " + ownerNoticePath + ".");
      } else {
        const result = await checkRights();
        console.log(
          "Rights register and artwork agree (" +
            result.held +
            " held artworks in held/" +
            (result.absent ? ", " + result.absent + " absent in this public-safe checkout" : "") +
            ").",
        );
      }
    } catch (error) {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    }
  }
}
