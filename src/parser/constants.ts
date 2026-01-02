/**
 * ANSI escape codes for enabling and disabling different mouse tracking modes in terminals.
 * These codes are used to control how the terminal reports mouse events.
 */
const ANSI_CODES = {
  // Terminal will send event on button pressed with mouse position
  // SET_VT200_MOUSE
  mouseButton: { on: '\x1b[?1000h', off: '\x1b[?1000l' },

  // Terminal will send event on button pressed and mouse motion as long as a button is down, with mouse position
  // SET_BTN_EVENT_MOUSE
  mouseDrag: { on: '\x1b[?1002h', off: '\x1b[?1002l' },

  // Terminal will send event on button pressed and motion
  // SET_ANY_EVENT_MOUSE
  mouseMotion: { on: '\x1b[?1003h', off: '\x1b[?1003l' },

  // Another mouse protocol that extend coordinate mapping (without it, it supports only 223 rows and columns)
  // SET_SGR_EXT_MODE_MOUSE
  mouseSGR: { on: '\x1b[?1006h', off: '\x1b[?1006l' },
};

/**
 * Regular expression patterns for parsing ANSI escape sequences that contain mouse event data.
 * These patterns match the different formats terminals use to report mouse positions and button states.
 */
const ANSI_RESPONSE_PATTERNS = {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: need for mouse events
  sgrPattern: /\x1b\[<(\d+);(\d+);(\d+)([Mm])/,

  // biome-ignore lint/suspicious/noControlCharactersInRegex: need for mouse events
  escPattern: /\x1b\[M([\x20-\x7f])([\x20-\x7f])([\x20-\x7f])/,
};

export { ANSI_CODES, ANSI_RESPONSE_PATTERNS };
