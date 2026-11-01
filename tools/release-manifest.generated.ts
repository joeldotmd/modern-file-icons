// Generated from schemas/release-manifest.schema.json. Do not edit by hand.

export type IconId = string;

/**
 * A built theme's manifest.json: VS Code file icon theme mappings plus Modern File Icons rendering metadata.
 */
export interface ReleaseManifest {
  iconDefinitions: {
    [k: string]: {
      /**
       * Relative to manifest.json; always a flat SVG file under icons/.
       */
      iconPath: string;
    };
  };
  file: IconId;
  folder: IconId;
  folderExpanded: IconId;
  rootFolder: IconId;
  rootFolderExpanded: IconId;
  fileNames: Associations;
  fileExtensions: Associations;
  languageIds: Associations;
  folderNames: Associations;
  folderNamesExpanded: Associations;
  /**
   * Overrides for a light host appearance; only decisions whose colour differs.
   */
  light: {
    file?: IconId;
    folder?: IconId;
    folderExpanded?: IconId;
    rootFolder?: IconId;
    rootFolderExpanded?: IconId;
    fileNames?: Associations;
    fileExtensions?: Associations;
    languageIds?: Associations;
    folderNames?: Associations;
    folderNamesExpanded?: Associations;
  };
  modernFileIcons: {
    theme: string;
    name: string;
    version: string;
    profile: "preview" | "release";
    /**
     * Fraction of the icon size each image extends past its layout box per side.
     */
    bleed: number;
    bleedUnits: number;
    /**
     * CSS pixel sizes for icons drawn at a fixed size, keyed by icon definition.
     */
    fixedSizes: {
      [k: string]: number;
    };
    /**
     * The theme definition's source record, as in theme.schema.json.
     */
    source: {
      [k: string]: unknown;
    };
    decisions: number;
    fallbacks: number;
  };
}
export interface Associations {
  [k: string]: IconId;
}
