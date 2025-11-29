import { describe, expect, test } from 'bun:test';

import { parseMouseEvents } from './ansiParser';

// Test data
const SGR_PRESS_LEFT = '\x1b[<0;10;20M';
const SGR_PRESS_MIDDLE = '\x1b[<1;10;20M';
const SGR_RELEASE_LEFT = '\x1b[<0;10;20m';
const SGR_DRAG_LEFT = '\x1b[<32;10;20M';
const SGR_WHEEL_UP = '\x1b[<64;10;20M';
const SGR_WHEEL_DOWN = '\x1b[<65;10;20M';
const SGR_WHEEL_LEFT = '\x1b[<66;10;20M';
const SGR_WHEEL_RIGHT = '\x1b[<67;10;20M';
const SGR_MOVE = '\x1b[<35;10;20M';

const ESC_PRESS_LEFT = '\x1b[M #4'; // button 0, x=3, y=20
const ESC_PRESS_MIDDLE = '\x1b[M!#4';
const ESC_PRESS_RIGHT = '\x1b[M"#4';
const ESC_RELEASE = '\x1b[M##4';
const ESC_DRAG_LEFT = '\x1b[M@#4';
const ESC_WHEEL_UP = '\x1b[M`#4';
const ESC_WHEEL_DOWN = '\x1b[Ma#4';
const ESC_MOVE = '\x1b[MC#4';

test('parseMouseEvents should return an empty array for invalid input', () => {
  const events = [...parseMouseEvents('invalid string')];
  expect(events).toEqual([]);
});

test('parseMouseEvents should correctly parse a single SGR press event', () => {
  const events = [...parseMouseEvents(SGR_PRESS_LEFT)];
  expect(events.length).toBe(1);
  const event = events[0];
  expect(event?.protocol).toBe('SGR');
  expect(event?.action).toBe('press');
  expect(event?.button).toBe('left');
  expect(event?.x).toBe(10);
  expect(event?.y).toBe(20);
});

test('parseMouseEvents should correctly parse a single SGR release event', () => {
  const events = [...parseMouseEvents(SGR_RELEASE_LEFT)];
  expect(events.length).toBe(1);
  const event = events[0];
  expect(event?.protocol).toBe('SGR');
  expect(event?.action).toBe('release');
  expect(event?.button).toBe('left'); // Button is preserved on release
});

test('parseMouseEvents should correctly parse a single SGR wheel up event', () => {
  const events = [...parseMouseEvents(SGR_WHEEL_UP)];
  expect(events.length).toBe(1);
  const event = events[0];
  expect(event?.protocol).toBe('SGR');
  expect(event?.action).toBe('wheel');
  expect(event?.button).toBe('wheel-up');
});

test('parseMouseEvents should correctly parse a single ESC press event', () => {
  const events = [...parseMouseEvents(ESC_PRESS_LEFT)];
  expect(events.length).toBe(1);
  const event = events[0];
  expect(event?.protocol).toBe('ESC');
  expect(event?.action).toBe('press');
  expect(event?.button).toBe('left');
  expect(event?.x).toBe(3);
  expect(event?.y).toBe(20);
});

test('parseMouseEvents should correctly parse a single ESC release event', () => {
  const events = [...parseMouseEvents(ESC_RELEASE)];
  expect(events.length).toBe(1);
  const event = events[0];
  expect(event?.protocol).toBe('ESC');
  expect(event?.action).toBe('release');
  expect(event?.button).toBe('none');
});

test('parseMouseEvents should correctly parse a single ESC wheel down event', () => {
  const events = [...parseMouseEvents(ESC_WHEEL_DOWN)];
  expect(events.length).toBe(1);
  const event = events[0];
  expect(event?.protocol).toBe('ESC');
  expect(event?.action).toBe('wheel');
  expect(event?.button).toBe('wheel-down');
});

test('parseMouseEvents should correctly parse a single ESC wheel left event', () => {
  const events = [...parseMouseEvents('\x1b[MbSJ')]; // 'b'.charCodeAt(0) - 32 = 66
  expect(events.length).toBe(1);
  const event = events[0];
  expect(event?.protocol).toBe('ESC');
  expect(event?.action).toBe('wheel');
  expect(event?.button).toBe('wheel-left');
});

test('parseMouseEvents should correctly parse a single ESC wheel right event', () => {
  const events = [...parseMouseEvents('\x1b[McSJ')]; // 'c'.charCodeAt(0) - 32 = 67
  expect(events.length).toBe(1);
  const event = events[0];
  expect(event?.protocol).toBe('ESC');
  expect(event?.action).toBe('wheel');
  expect(event?.button).toBe('wheel-right');
});

test('parseMouseEvents should handle multiple, concatenated events', () => {
  const input = SGR_PRESS_LEFT + SGR_WHEEL_UP + ESC_PRESS_RIGHT + SGR_RELEASE_LEFT;
  const events = [...parseMouseEvents(input)];

  expect(events.length).toBe(4);

  expect(events[0]?.protocol).toBe('SGR');
  expect(events[0]?.button).toBe('left');

  expect(events[1]?.protocol).toBe('SGR');
  expect(events[1]?.button).toBe('wheel-up');

  expect(events[2]?.protocol).toBe('ESC');
  expect(events[2]?.button).toBe('right');

  expect(events[3]?.protocol).toBe('SGR');
  expect(events[3]?.action).toBe('release');
});

test('parseMouseEvents should handle data with surrounding text', () => {
  const input = `some text before ${SGR_PRESS_LEFT} and some text after`;
  const events = [...parseMouseEvents(input)];

  expect(events.length).toBe(1);
  expect(events[0]?.protocol).toBe('SGR');
  expect(events[0]?.button).toBe('left');
  expect(events[0]?.x).toBe(10);
});

test('parseMouseEvents should handle all SGR variations', () => {
  const inputs = {
    SGR_PRESS_MIDDLE,
    SGR_DRAG_LEFT,
    SGR_WHEEL_DOWN,
    SGR_WHEEL_LEFT,
    SGR_WHEEL_RIGHT,
    SGR_MOVE,
  };

  for (const key in inputs) {
    const input = inputs[key as keyof typeof inputs];
    const events = [...parseMouseEvents(input)];
    expect(events.length).toBe(1);
    expect(events[0]?.protocol).toBe('SGR');
  }
});

test('parseMouseEvents should handle all ESC variations', () => {
  const inputs = {
    ESC_PRESS_MIDDLE,
    ESC_PRESS_RIGHT,
    ESC_DRAG_LEFT,
    ESC_WHEEL_UP,
    ESC_MOVE,
  };

  for (const key in inputs) {
    const input = inputs[key as keyof typeof inputs];
    const events = [...parseMouseEvents(input)];
    expect(events.length).toBe(1);
    expect(events[0]?.protocol).toBe('ESC');
  }
});

describe('Coverage-specific tests', () => {
  test('should parse SGR right-click', () => {
    const events = [...parseMouseEvents('\x1b[<2;10;20M')];
    expect(events[0]?.button).toBe('right');
  });

  test('should parse SGR back button', () => {
    const events = [...parseMouseEvents('\x1b[<128;10;20M')];
    expect(events[0]?.button).toBe('back');
  });

  test('should parse SGR forward button', () => {
    const events = [...parseMouseEvents('\x1b[<129;10;20M')];
    expect(events[0]?.button).toBe('forward');
  });

  test('should handle unknown SGR button', () => {
    const events = [...parseMouseEvents('\x1b[<200;10;20M')];
    expect(events[0]?.button).toBe('unknown');
  });

  test('should handle unknown ESC button', () => {
    // ESC button codes are masked, so we need a value that doesn't map to left/middle/right
    // 0b01000111 -> char 'G' -> cb 39. & 3 = 3 (none), & 64 = 0. This will be 'none'.
    // To hit unknown, we need a logic branch that is not possible with current decode.
    // The default 'unknown' in decodeESCButton is unreachable because of the switch on `code & 3`.
    // We will test the 'none' case which was also uncovered.
    const events = [...parseMouseEvents('\x1b[M#  ')]; // cb = 35 -> &3 = 3 -> 'none'
    expect(events[0]?.button).toBe('none');
  });

  test('should skip unrecognized escape sequences', () => {
    const input = `\x1b[2J${SGR_PRESS_LEFT}`;
    const events = [...parseMouseEvents(input)];
    expect(events.length).toBe(1);
    expect(events[0]?.button).toBe('left');
  });

  test('should handle input with no escape sequences', () => {
    const input = 'hello world';
    const events = [...parseMouseEvents(input)];
    expect(events.length).toBe(0);
  });

  test('should handle incomplete SGR sequence', () => {
    const input = '\x1b[<0;10;';
    const events = [...parseMouseEvents(input)];
    expect(events.length).toBe(0);
  });

  test('parseMouseEvents should ignore non-mouse ANSI events and other characters', () => {
    const SGR_PRESS = '\x1b[<0;10;20M';
    const ARROW_UP = '\x1b[A';
    const CHAR_A = 'a';
    const SGR_WHEEL = '\x1b[<64;10;20M';

    const input = `${SGR_PRESS}${ARROW_UP}${CHAR_A}${SGR_WHEEL}`;
    const events = [...parseMouseEvents(input)];

    expect(events.length).toBe(2);
    expect(events[0]?.button).toBe('left');
    expect(events[1]?.button).toBe('wheel-up');
  });

  test('parseMouseEvents should perform run-length deduplication', () => {
    const SGR_EVENT_1 = '\x1b[<0;10;20M';
    const SGR_EVENT_2 = '\x1b[<1;11;21M';
    const ESC_EVENT_1 = '\x1b[M #4'; // button 0, x=3, y=20

    const input =
      SGR_EVENT_1 + // First unique event
      SGR_EVENT_1 + // Duplicate, should be ignored
      SGR_EVENT_1 + // Duplicate, should be ignored
      SGR_EVENT_2 + // New unique event
      SGR_EVENT_2 + // Duplicate, should be ignored
      ESC_EVENT_1 + // New unique event
      SGR_EVENT_1; // New unique event (different from previous ESC_EVENT_1)

    const events = [...parseMouseEvents(input)];

    expect(events.length).toBe(4); // SGR_EVENT_1, SGR_EVENT_2, ESC_EVENT_1, SGR_EVENT_1

    expect(events[0]?.data).toBe(SGR_EVENT_1);
    expect(events[1]?.data).toBe(SGR_EVENT_2);
    expect(events[2]?.data).toBe(ESC_EVENT_1);
    expect(events[3]?.data).toBe(SGR_EVENT_1);
  });

  test('should handle unknown SGR wheel codes', () => {
    // Test wheel codes that are not in the expected range (64-67)
    // This should hit line 44 in decodeSGRButton: button = 'unknown'
    const events = [...parseMouseEvents('\x1b[<200;10;20M')]; // wheel code 200 (unknown)
    expect(events[0]?.button).toBe('unknown');
    expect(events[0]?.action).toBe('press'); // unknown buttons default to press
  });

  test('should handle unknown ESC wheel codes', () => {
    // Test ESC wheel codes that are not in expected range (64-67)
    // Need to construct ESC sequence with code that has bit 64 set but not 64-67
    // ESC format: \x1b[M<cb><cx><cy> where cb = button code + 32
    // For wheel code 68: cb = 68 + 32 = 100, char 'd'
    const events = [...parseMouseEvents('\x1b[MdSJ')]; // 'd'.charCodeAt(0) - 32 = 68 (unknown wheel)
    expect(events[0]?.button).toBe('unknown');
    expect(events[0]?.action).toBe('press'); // unknown buttons default to press, not wheel
  });

  test('should handle NaN values in SGR coordinates', () => {
    // Test malformed SGR sequences with non-numeric coordinates
    // This should hit line 134: return [null, start + 1]
    const events = [...parseMouseEvents('\x1b[<0;abc;20M')];
    expect(events.length).toBe(0); // Should return empty due to NaN parsing
  });

  test('should handle NaN values in SGR button code', () => {
    // Test malformed SGR sequences with non-numeric button code
    const events = [...parseMouseEvents('\x1b[<abc;10;20M')];
    expect(events.length).toBe(0); // Should return empty due to NaN parsing
  });

  test('should handle NaN values in SGR y coordinate', () => {
    // Test malformed SGR sequences with non-numeric y coordinate
    const events = [...parseMouseEvents('\x1b[<0;10;xyzM')];
    expect(events.length).toBe(0); // Should return empty due to NaN parsing
  });
});
