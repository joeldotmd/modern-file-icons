// Generated from schemas/icon.schema.json. Do not edit by hand.

export interface IconMetadata {
  id: string;
  name: string;
  category: "folder" | "file" | "symbol";
  style: "outline" | "filled" | "mixed";
  sources: {
    library: string;
    icon: string;
    version: string;
    license: string;
  }[];
  customization: {
    color: boolean;
    strokeWidth: boolean;
  };
  variantGroup?: string;
  modifications?: string;
  trademark?: string;
  /**
   * Review candidate this artwork was imported from.
   */
  origin?: {
    /**
     * Seed id of the review selector this artwork was picked from.
     */
    seed: string;
    candidate: string;
    /**
     * SHA-256 of the canonical SVG file as imported; detects later edits.
     */
    sha256?: string;
  };
  /**
   * Distribution gate. Held artwork is excluded from release builds.
   */
  release?: {
    status: "eligible" | "held";
    basis: string;
  };
  /**
   * Rights for brand or owner artwork, generated from the theme's rights register. Not a clearance.
   */
  rights?: {
    decision: string;
    assessment: "PERMITTED" | "CONDITIONAL" | "PERMISSION-NEEDED" | "PROHIBITED" | "UNVERIFIED";
    /**
     * Licence of the depicted owner artwork (SPDX identifier or LicenseRef).
     */
    license: string;
    licenseText: string;
    credit: string;
    notice?: string;
    /**
     * Change notice for this file.
     */
    changes: string;
    /**
     * This file must be shared under the same licence.
     */
    shareAlike: boolean;
    /**
     * Only unmodified or technically converted copies may be shared.
     */
    noDerivatives: boolean;
    /**
     * Open questions that keep artwork held.
     */
    unresolved?: string[];
    /**
     * Where the licensed material was obtained.
     */
    source?: string;
  };
}
