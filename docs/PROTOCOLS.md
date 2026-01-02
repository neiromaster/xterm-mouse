# Xterm Mouse Protocols - Technical Reference

> [!NOTE]
> This document provides a deep technical dive into the mouse protocols supported by xterm-mouse. For user-facing documentation, see the main [README](../README.md).

## Table of Contents

- [Overview](#overview)
- [Terminal Mouse Tracking Modes](#terminal-mouse-tracking-modes)
- [SGR Protocol (Extended)](#sgr-protocol-extended)
- [ESC Protocol (Legacy)](#esc-protocol-legacy)
- [Protocol Detection](#protocol-detection)
- [Coordinate Systems](#coordinate-systems)
- [Modifier Keys](#modifier-keys)
- [Terminal Compatibility](#terminal-compatibility)

## Overview

The xterm-mouse library supports two major terminal mouse protocols:

1. **SGR (SGR-Style) Protocol** - Modern, extended coordinate format (DECSET 1006)
2. **ESC (Legacy) Protocol** - Original xterm mouse protocol (DECSET 1000/1002/1003)

Both protocols are enabled simultaneously by the library, and incoming events are automatically detected and parsed based on their format.

## Terminal Mouse Tracking Modes

### DECSET Mode Numbers

| Mode | Description | ANSI Enable Code | ANSI Disable Code |
|------|-------------|------------------|-------------------|
| 1000 | VT200 Mouse - Send events on button press | `\x1b[?1000h` | `\x1b[?1000l` |
| 1002 | Button Event Mouse - Send events on button press and drag | `\x1b[?1002h` | `\x1b[?1002l` |
| 1003 | Any Event Mouse - Send events on all mouse movements | `\x1b[?1003h` | `\x1b[?1003l` |
| 1006 | SGR Extended Mode - Use SGR format for coordinates | `\x1b[?1006h` | `\x1b[?1006l` |

> [!TIP]
> The library enables all modes (1000, 1002, 1003, 1006) to ensure maximum mouse event coverage across different terminal behaviors.

### How the Library Enables Mouse Tracking

```typescript
// From src/core/Mouse.ts
this.outputStream.write(
  ANSI_CODES.mouseButton.on +   // \x1b[?1000h
  ANSI_CODES.mouseDrag.on +     // \x1b[?1002h
  ANSI_CODES.mouseMotion.on +   // \x1b[?1003h
  ANSI_CODES.mouseSGR.on        // \x1b[?1006h
);
```

## SGR Protocol (Extended)

The SGR (Select Graphic Rendition) style protocol is the modern standard for mouse reporting. It uses a human-readable, semicolon-separated format.

### Format

```
ESC [ < b ; x ; y M
```

Where:
- `ESC [ <` - Protocol prefix (literal characters)
- `b` - Button code (integer)
- `x` - Column coordinate (1-indexed, integer)
- `y` - Row coordinate (1-indexed, integer)
- `M` - Terminator character: `M` for press, `m` for release

### Byte Sequence

```
0x1b 0x5b 0x3c [button bytes] 0x3b [x bytes] 0x3b [y bytes] 0x4d/0x6d
```

### Button Encoding

The button code `b` contains both button identity and modifier key state:

| Button Code | Button Type | Action |
|-------------|-------------|--------|
| 0 | Left | Press |
| 1 | Middle | Press |
| 2 | Right | Press |
| 3 | None | Release (when combined with `m` terminator) |
| 64 | Wheel Up | Scroll |
| 65 | Wheel Down | Scroll |
| 66 | Wheel Left | Horizontal scroll |
| 67 | Wheel Right | Horizontal scroll |
| 128 | Back | Browser back button |
| 129 | Forward | Browser forward button |

### Modifier Bits (SGR)

| Bit | Value | Modifier |
|-----|-------|----------|
| 2 | 4 | Shift key held |
| 3 | 8 | Alt (Meta) key held |
| 4 | 16 | Ctrl key held |
| 5 | 32 | Motion flag (set for drag/move events) |

The actual button is extracted by masking out the modifier bits:
```typescript
const modifierBits = 4 | 8 | 16 | 32;  // 0x3C
const buttonCode = rawCode & ~modifierBits;
```

### Terminator Character

- `M` (0x4d) - Button press event
- `m` (0x6d) - Button release event

> [!IMPORTANT]
> In SGR protocol, button releases are indicated by the `m` terminator, not by button code 3. This is a key difference from the ESC protocol.

### Example Escape Sequences

| Action | Escape Sequence | Decoded |
|--------|-----------------|---------|
| Left click at (1,1) | `\x1b[<0;1;1M` | button=0, x=1, y=1, press |
| Left release at (1,1) | `\x1b[<0;1;1m` | button=0, x=1, y=1, release |
| Right click at (10,5) with Ctrl | `\x1b[<18;10;5M` | button=2 + Ctrl(16), x=10, y=5 |
| Wheel up at (42,13) | `\x1b[<64;42;13M` | button=64 (wheel-up), x=42, y=13 |
| Drag left button at (7,3) | `\x1b[<32;7;3M` | button=0 + motion(32), x=7, y=3 |

### Regex Pattern

```typescript
// From src/parser/constants.ts
const sgrPattern = /\x1b\[<(\d+);(\d+);(\d+)([Mm])/;
```

Capture groups:
1. Button code
2. X coordinate
3. Y coordinate
4. Terminator character

### Advantages of SGR Protocol

1. **Extended coordinates** - Supports large terminals (beyond 223 columns/rows)
2. **Human-readable** - Easy to parse and debug
3. **Clear release indication** - Uses `m` terminator for release events
4. **Explicit button encoding** - No ambiguity between buttons 0-3 and modifier bits

## ESC Protocol (Legacy)

The ESC protocol is the original xterm mouse tracking format. It uses a compact binary encoding within printable character ranges.

### Format

```
ESC [ M b x y
```

Where `b`, `x`, and `y` are **single bytes** encoded as `value + 32`.

### Byte Sequence

```
0x1b 0x5b 0x4d [b+32] [x+32] [y+32]
```

### Button Encoding

The button byte `b` uses a compact bit-packed format:

| Bit 7 | Bit 6 | Bit 5 | Bit 4 | Bit 3 | Bit 2 | Bit 1-0 |
|-------|-------|-------|-------|-------|-------|---------|
| Wheel | (unused) | Motion | Ctrl | Alt | Shift | Button ID (0-3) |
| 64 | 32 | 16 | 8 | 4 | 2 | 1 |

#### Button ID (Bits 0-1)

| Value | Button |
|-------|--------|
| 0 | Left |
| 1 | Middle |
| 2 | Right |
| 3 | Release (no button) |

#### Wheel Encoding (Bit 6)

When bit 6 (value 64) is set:
| Button Code | Wheel Direction |
|-------------|-----------------|
| 64 | Wheel Up |
| 65 | Wheel Down |
| 66 | Wheel Left |
| 67 | Wheel Right |

#### Modifier Bits (ESC)

| Bit | Value | Modifier |
|-----|-------|----------|
| 2 | 4 | Shift key held |
| 3 | 8 | Alt (Meta) key held |
| 4 | 16 | Ctrl key held |
| 5 | 32 | Motion flag (set for drag/move events) |

### Coordinate Encoding

Coordinates are encoded as single bytes with an offset of +32:
```typescript
const encodedX = x + 32;  // Must be <= 255
const encodedY = y + 32;  // Must be <= 255
```

This means the **maximum coordinate value is 223** (255 - 32).

> [!CAUTION]
> The ESC protocol cannot report positions beyond column 223 or row 223. For larger terminals, use SGR protocol.

### Example Escape Sequences

| Action | Escape Sequence | Decoded |
|--------|-----------------|---------|
| Left click at (1,1) | `\x1b[M  !!` | b=0(#40), x=1(!), y=1(!) |
| Left release at (1,1) | `\x1b[M#! !` | b=3(#), x=1(!), y=1(!) |
| Right click at (10,5) | `\x1b[M \x1b\x19%` | b=2("), x=10(\n), y=5(%) |
| Wheel up at (42,13) | `\x1b[M@-M` | b=64(@), x=42(-), y=13(M) |
| Drag left at (7,3) | `\x1b[M `!`#` | b=32(`), x=7(!), y=3(#) |

*Note: The character encoding uses printable ASCII range (32-127)*

### Regex Pattern

```typescript
// From src/parser/constants.ts
const escPattern = /\x1b\[M([\x20-\x7f])([\x20-\x7f])([\x20-\x7f])/;
```

Capture groups:
1. Button byte (encoded as value + 32)
2. X coordinate byte (encoded as value + 32)
3. Y coordinate byte (encoded as value + 32)

### Release Detection in ESC Protocol

In ESC protocol, button release is indicated by button code 3 (bits 0-1 set to 11):

```typescript
if ((buttonCode & 3) === 3) {
  action = 'release';
}
```

This is different from SGR, which uses the terminator character.

### Limitations of ESC Protocol

1. **Coordinate limit** - Maximum of 223 columns/rows
2. **No clear release distinction** - Must infer from button code
3. **Less readable** - Binary encoding is harder to debug
4. **Compact but limited** - Single byte limits coordinate range

## Protocol Detection

The library automatically detects which protocol an incoming event uses by examining the escape sequence:

```typescript
// From src/parser/ansiParser.ts
if (data[i + 2] === '<') {
  // SGR protocol: ESC [ < ...
  [event, nextIndex] = parseSGRMouseEvent(data, i);
} else if (data[i + 2] === 'M') {
  // ESC protocol: ESC [ M ...
  [event, nextIndex] = parseESCMouseEvent(data, i);
}
```

Both protocols can be active simultaneously, and the terminal will choose which format to send based on the DECSET modes enabled.

## Coordinate Systems

### Origin and Indexing

- **Origin**: Top-left corner of the terminal
- **Indexing**: 1-based (first column is 1, first row is 1)

### Coordinate Limits

| Protocol | Maximum X | Maximum Y | Reason |
|----------|-----------|-----------|--------|
| SGR | Unlimited* | Unlimited* | Uses decimal integer encoding |
| ESC | 223 | 223 | Single byte + 32 offset |

*In practice, limited by terminal size and integer representation

### Run-Length Deduplication

The parser implements run-length deduplication to filter duplicate events:

```typescript
// From src/parser/ansiParser.ts
if (event.data !== lastEventData) {
  yield event;
  lastEventData = event.data;
}
```

This prevents the same event from being emitted multiple times if the terminal sends duplicate escape sequences.

## Modifier Keys

Both protocols encode modifier keys (Shift, Alt, Ctrl) in the button code byte.

### Modifier Bit Positions

| Modifier | SGR Bit | ESC Bit | Value |
|----------|---------|---------|-------|
| Shift | 2 | 2 | 4 |
| Alt (Meta) | 3 | 3 | 8 |
| Ctrl | 4 | 4 | 16 |
| Motion | 5 | 5 | 32 |

### Detection Code

```typescript
// Same for both protocols after extracting button code
const shift = !!(buttonCode & 4);
const alt = !!(buttonCode & 8);
const ctrl = !!(buttonCode & 16);
const motion = !!(buttonCode & 32);
```

## Terminal Compatibility

### Protocol Support Matrix

| Terminal | SGR (1006) | ESC (1000/1002/1003) | Notes |
|----------|------------|----------------------|-------|
| xterm | ✅ | ✅ | Reference implementation |
| iTerm2 | ✅ | ✅ | Full support |
| Terminal.app | ✅ | ✅ | macOS default |
| GNOME Terminal | ✅ | ✅ | VTE-based |
| Alacritty | ✅ | ✅ | Modern GPU terminal |
| Kitty | ✅ | ✅ | GPU-accelerated |
| Windows Terminal | ✅ | ⚠️ | Partial ESC support |
| cmd.exe | ❌ | ❌ | No mouse support |
| PuTTY | ✅ | ✅ | SSH client |

### Testing for Mouse Support

To check if a terminal supports mouse tracking, examine the `DA1` (Device Attributes) response:

```bash
# Query terminal capabilities
echo -ne '\x1b[c'

# Response will include capabilities
# For mouse support, look for '?1000', '?1002', '?1003', '?1006'
```

### Fallback Strategy

The library enables both protocols simultaneously. The terminal will typically:
1. Use SGR format if DECSET 1006 is supported (preferred)
2. Fall back to ESC format if only DECSET 1000/1002/1003 are supported

## Event Examples

### Complete Event Flow

```typescript
// User clicks left mouse button at column 12, row 5
// Terminal sends: \x1b[<0;12;5M

{
  protocol: 'SGR',
  button: 'left',
  action: 'press',
  x: 12,
  y: 5,
  shift: false,
  alt: false,
  ctrl: false,
  raw: 0,
  data: '\x1b[<0;12;5M'
}

// User releases button
// Terminal sends: \x1b[<0;12;5m

{
  protocol: 'SGR',
  button: 'left',
  action: 'release',
  x: 12,
  y: 5,
  shift: false,
  alt: false,
  ctrl: false,
  raw: 0,
  data: '\x1b[<0;12;5m'
}

// Library synthesizes click event
{
  protocol: 'SGR',
  button: 'left',
  action: 'click',
  x: 12,
  y: 5,
  shift: false,
  alt: false,
  ctrl: false,
  raw: 0,
  data: '\x1b[<0;12;5m'  // From release event
}
```

## References

- [Xterm Control Sequences](https://invisible-island.net/xterm/ctlseqs/ctlseqs.html#Mouse%20Tracking) - Official xterm documentation
- [DECSET Mode Numbers](https://vt100.net/docs/vt510-rm/DECSET.html) - VT510 reference manual
- [ECMA-48](https://www.ecma-international.org/publications-and-standards/standards/ecma-48/) - Standard for terminal control sequences
