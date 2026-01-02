type NoneButton = 'none';

export type ButtonType =
  | NoneButton
  | 'left'
  | 'middle'
  | 'right'
  | 'wheel-up'
  | 'wheel-down'
  | 'wheel-left'
  | 'wheel-right'
  | 'back'
  | 'forward'
  | 'unknown';

export type MouseEventAction = 'move' | 'release' | 'press' | 'drag' | 'wheel' | 'click';

export type MouseEventBase = {
  x: number;
  y: number;
  button: ButtonType;
  action: MouseEventAction;
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
  raw: number;
  data: string;
};

export type SGRMouseEvent = MouseEventBase & {
  protocol: 'SGR';
};

export type ESCMouseEvent = MouseEventBase & {
  protocol: 'ESC';
};

export type MouseEvent = SGRMouseEvent | ESCMouseEvent;

export interface ReadableStreamWithEncoding extends NodeJS.ReadStream {
  readableEncoding: BufferEncoding | null;
}

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

/**
 * Custom error class for errors that occur within the Mouse class.
 * This allows for more specific error handling and preserves the original error.
 */
export class MouseError extends Error {
  /**
   * @param message The error message.
   * @param originalError The original error, if any.
   */
  constructor(
    message: string,
    public originalError?: Error,
  ) {
    super(message);
    this.name = 'MouseError';
  }
}
