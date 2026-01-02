type NoneButton = 'none';

/**
 * Represents a mouse button identifier.
 *
 * Button types indicate which physical mouse button or wheel action triggered an event.
 *
 * | Button | Description |
 * |--------|-------------|
 * | `'none'` | No button pressed (used for movement events) |
 * | `'left'` | Primary (left) mouse button |
 * | `'middle'` | Middle mouse button (often the scroll wheel click) |
 * | `'right'` | Secondary (right) mouse button |
 * | `'wheel-up'` | Mouse wheel scrolled up/away from user |
 * | `'wheel-down'` | Mouse wheel scrolled down/toward user |
 * | `'wheel-left'` | Mouse wheel scrolled left (horizontal scroll) |
 * | `'wheel-right'` | Mouse wheel scrolled right (horizontal scroll) |
 * | `'back'` | Back button (typically side button on mice with 5+ buttons) |
 * | `'forward'` | Forward button (typically side button on mice with 5+ buttons) |
 * | `'unknown'` | Unknown button type (fallback for unrecognized codes) |
 */
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

/**
 * Represents the type of mouse action that occurred.
 *
 * Action types describe the state change or interaction that triggered the event.
 *
 * | Action | Description |
 * |--------|-------------|
 * | `'move'` | Mouse moved without any button pressed |
 * | `'press'` | A mouse button was pressed down |
 * | `'release'` | A mouse button was released |
 * | `'drag'` | Mouse moved while a button was held down |
 * | `'wheel'` | Mouse wheel was scrolled |
 * | `'click'` | A button was pressed and released within the threshold distance (synthesized event) |
 */
export type MouseEventAction = 'move' | 'release' | 'press' | 'drag' | 'wheel' | 'click';

/**
 * Base interface for all mouse event types.
 *
 * This interface contains the common properties shared across all mouse events,
 * regardless of the protocol used to encode them.
 *
 * @property x - The x-coordinate (column) of the mouse position (1-indexed)
 * @property y - The y-coordinate (row) of the mouse position (1-indexed)
 * @property button - The button that triggered the event
 * @property action - The type of action that occurred
 * @property shift - Whether the Shift key was held during the event
 * @property alt - Whether the Alt key was held during the event
 * @property ctrl - Whether the Ctrl key was held during the event
 * @property raw - The raw button code from the terminal protocol
 * @property data - The raw ANSI escape sequence data received from the terminal
 */
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

/**
 * A mouse event using the SGR (Select Graphic Rendition) protocol.
 *
 * The SGR protocol is the modern, preferred encoding for terminal mouse events.
 * It uses the format `ESC[<Cb;Cx;CyM` (press) or `ESC[<Cb;Cx;Cym` (release),
 * where the terminator character ('M' or 'm') distinguishes press from release.
 *
 * Advantages over the legacy ESC protocol:
 * - Supports coordinates beyond 223 (practically unlimited)
 * - Clearer encoding of button state and actions
 * - Better support for modern terminal features
 *
 * @example
 * ```ts
 * if (event.protocol === 'SGR') {
 *   // This is an SGR event with high-precision coordinates
 *   console.log(`Position: ${event.x}, ${event.y}`);
 * }
 * ```
 */
export type SGRMouseEvent = MouseEventBase & {
  protocol: 'SGR';
};

/**
 * A mouse event using the legacy ESC (escape sequence) protocol.
 *
 * The ESC protocol is the original mouse encoding scheme for terminals.
 * It uses the format `ESCCbCxCyM` where coordinates are encoded as
 * characters (code + 32) and button/action state is packed into a single byte.
 *
 * Limitations compared to SGR:
 * - Maximum coordinate value of 223 (0-indexed: 222) - some terminals limit to 95
 * - Less clear encoding of button state and release events
 * - No dedicated release encoding (release is inferred from button code 3)
 *
 * Despite limitations, this protocol is still widely supported by older terminals
 * and is used as a fallback when SGR is not available.
 *
 * @example
 * ```ts
 * if (event.protocol === 'ESC') {
 *   // This is an ESC event with potential coordinate limitations
 *   if (event.x > 95) {
 *     console.warn('Coordinates may be truncated on some terminals');
 *   }
 * }
 * ```
 */
export type ESCMouseEvent = MouseEventBase & {
  protocol: 'ESC';
};

/**
 * A discriminated union representing any mouse event from either protocol.
 *
 * This type combines both SGR and ESC mouse event types. The `protocol` property
 * serves as a discriminant that allows TypeScript to narrow the type.
 *
 * @example
 * ```ts
 * mouse.on('press', (event: MouseEvent) => {
 *   if (event.protocol === 'SGR') {
 *     // TypeScript knows this is SGRMouseEvent
 *     console.log('Using modern SGR protocol');
 *   } else {
 *     // TypeScript knows this is ESCMouseEvent
 *     console.log('Using legacy ESC protocol');
 *   }
 * });
 * ```
 */
export type MouseEvent = SGRMouseEvent | ESCMouseEvent;

/**
 * Extends NodeJS.ReadStream to include the readableEncoding property.
 *
 * This interface is used to provide type safety when accessing the encoding
 * of a readable stream. The standard NodeJS.ReadStream type does not include
 * the readableEncoding property in its type definition, so we extend it here.
 *
 * @property readableEncoding - The current encoding of the readable stream, or null if not set
 *
 * @example
 * ```ts
 * function setupStream(stream: ReadableStreamWithEncoding) {
 *   // TypeScript knows about readableEncoding
 *   const currentEncoding = stream.readableEncoding;
 *   console.log(`Stream encoding: ${currentEncoding}`);
 * }
 * ```
 */
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
