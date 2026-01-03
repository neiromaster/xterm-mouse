/**
 * Configuration options for the Mouse class.
 * All properties are optional and provide sensible defaults.
 */
export type MouseOptions = {
  /**
   * Maximum allowed distance (in cells) between press and release to qualify as a click.
   * Defaults to 1, meaning the press and release must be within 1 cell in both X and Y directions.
   * Set to 0 to require exact same position, or higher values to allow more movement.
   */
  clickDistanceThreshold?: number;
};
