// Generated from schemas/theme.schema.json, schemas/associations.schema.json, schemas/rights.schema.json. Do not edit by hand.

export type Sha256 = string;
export type DecisionId = string;
export type ArtworkId = string;
export type Hex = string;

/**
 * Maps each logical filesystem decision to canonical artwork and its appearance defaults.
 */
export interface ThemeDefinition {
  id: string;
  name: string;
  version: string;
  source: {
    selector: {
      sha256: Sha256;
      seedId: string;
    };
    selections: SourceFile;
    calibration: SourceFile;
  };
  /**
   * Generic decisions used for unrecognized names and whenever selected artwork cannot ship.
   */
  fallbacks: {
    file: DecisionId;
    folder: DecisionId;
    rootFolder: DecisionId;
  };
  decisions: {
    [k: string]: Decision;
  };
}
export interface SourceFile {
  path: string;
  sha256: Sha256;
}
export interface Decision {
  kind: "file" | "folder";
  /**
   * The reviewed selector candidate, preserved even when it cannot be reproduced.
   */
  selection: {
    icon: string;
    expandedIcon: string | null;
  };
  artwork?: ArtworkId;
  expandedArtwork?: ArtworkId;
  /**
   * Why the selected artwork is not in the theme; builds use the generic fallback.
   */
  unavailable?: string;
  /**
   * Colour inherited by the artwork's currentColor in each host appearance.
   */
  color: {
    light: Hex;
    dark: Hex;
  };
  /**
   * Theme stroke adjustment applied to the whole artwork or only a composite's motif.
   */
  stroke?: {
    scope: "all" | "motif";
    scale: number;
    motifWidth?: number;
  };
  visualApproved: boolean;
  /**
   * CSS pixels the selector drew this artwork at whatever the cell size (an inline size on its source root). Hosts draw it at this size, plus the bleed, from the top-left of its layout box.
   */
  fixedSize?: number;
}

/**
 * Recognition aliases: each filename, extension, language ID or folder name maps to one decision.
 */
export interface ThemeAssociations {
  fileNames: Aliases;
  fileExtensions: Aliases;
  languageIds: Aliases;
  folderNames: Aliases;
}
export interface Aliases {
  [k: string]: string;
}

export type Text = string;
export type Status =
  "PERMITTED" | "CONDITIONAL" | "PERMISSION-NEEDED" | "PROHIBITED" | "UNVERIFIED";
export type Use = Status | "n/a";

/**
 * Evidence-based rights assessment for brand and owner artwork. It records obligations and open questions; it is not a clearance, and audited artwork stays held until a distribution approval is recorded.
 */
export interface RightsRegister {
  $schema?: string;
  audit: {
    date: string;
  };
  decisions: {
    [k: string]: RightsDecision;
  };
}
export interface RightsDecision {
  owner: Text;
  /**
   * Canonical artwork IDs; empty for excluded decisions that are not built.
   */
  artworks: string[];
  assessment: Status;
  /**
   * Assessment for each way this project distributes the artwork: in its public source, in theme packages, as a standalone file icon and inside a modified folder composite.
   */
  forms: {
    source: Use;
    package: Use;
    standaloneIcon: Use;
    folderComposite: Use;
  };
  /**
   * Copyright layer of the selected artwork: SPDX identifier or LicenseRef for owner terms that are not an open licence.
   */
  copyright: {
    license: string;
    licenseText: string;
    credit: Text;
    notice?: Text;
  };
  trademark?: Text;
  /**
   * Change notice for adaptations the canonical metadata cannot show (redraws, recolours).
   */
  changes?: string;
  /**
   * Obligations and use constraints as recorded by the audit.
   */
  conditions: Text[];
  /**
   * Open questions that keep artwork held.
   */
  unresolved?: Text[];
  sources: Text[];
  policies: Text[];
  excluded?: Text;
  /**
   * Approval to distribute the artwork in this project's source and theme packages. Supporting review records are not part of the distributable register.
   */
  approval?: {
    date: string;
  };
}
