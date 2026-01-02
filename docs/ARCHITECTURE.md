# Architecture - xterm-mouse Internal Design

> [!NOTE]
> This document describes the internal architecture of xterm-mouse for contributors and maintainers. For user-facing documentation, see the main [README](../README.md).

## Table of Contents

- [Overview](#overview)
- [Core Components](#core-components)
- [Data Flow](#data-flow)
- [Protocol Handling](#protocol-handling)
- [Event System](#event-system)
- [Streaming API](#streaming-api)
- [Design Patterns](#design-patterns)
- [Module Structure](#module-structure)

## Overview

The xterm-mouse library is structured as a layered architecture that handles terminal mouse events from raw ANSI escape sequences to high-level JavaScript event objects.

```
┌─────────────────────────────────────────────────────────────┐
│                      Application Layer                      │
│                 (User Code / Examples)                      │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                        Mouse Class                          │
│  - enable/disable tracking                                  │
│  - event emission (on/off)                                  │
│  - streaming API (stream/eventsOf)                          │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      Parser Layer                           │
│  - ANSI escape sequence parsing                             │
│  - SGR/ESC protocol decoding                                │
│  - button/action resolution                                 │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                   Terminal I/O Layer                        │
│  - process.stdin (input stream)                             │
│  - process.stdout (output stream)                           │
│  - ANSI escape codes (constants)                            │
└─────────────────────────────────────────────────────────────┘
```

## Core Components

### 1. Mouse Class (`src/core/Mouse.ts`)

The `Mouse` class is the main entry point and orchestrator of the library. It manages the entire lifecycle of mouse tracking.

#### Responsibilities

- **Stream Management**: Controls `process.stdin` and `process.stdout` settings
- **Protocol Activation**: Sends ANSI codes to enable/disable mouse tracking modes
- **Event Emission**: Wraps Node.js `EventEmitter` for event-based API
- **Click Detection**: Implements synthetic click event from press + release
- **Streaming**: Provides async generator APIs for modern async/await patterns

#### Key State

```typescript
private enabled = false;                    // Tracking state
private previousEncoding: BufferEncoding;   // Saved stream encoding
private previousRawMode: boolean;           // Saved raw mode state
private lastPress: MouseEvent | null;       // For click detection
```

#### Lifecycle Methods

| Method | Purpose |
|--------|---------|
| `enable()` | Activates mouse tracking, modifies stream settings |
| `disable()` | Deactivates tracking, restores original settings |
| `destroy()` | Full cleanup including all event listeners |

### 2. Parser Layer (`src/parser/`)

The parser layer is responsible for converting raw ANSI escape sequences into structured JavaScript objects.

#### ansiParser.ts

**Functions:**

- `parseMouseEvents(data: string)` - Main generator that yields parsed events
- `parseSGRMouseEvent(data, start)` - Parses SGR protocol events
- `parseESCMouseEvent(data, start)` - Parses legacy ESC protocol events
- `decodeSGRButton(code)` - Decodes SGR button codes to button/action
- `decodeESCButton(code)` - Decodes ESC button codes to button/action

**Algorithm:**

1. Scan input for ESC sequence prefix (`\x1b[`)
2. Branch based on protocol indicator (`<` for SGR, `M` for ESC)
3. Extract button, x, y coordinates via regex
4. Decode button code to determine button type and action
5. Extract modifier key states (Shift, Alt, Ctrl)
6. Apply run-length deduplication to filter duplicate events

#### constants.ts

Contains ANSI escape codes for terminal control and regex patterns for parsing.

```typescript
ANSI_CODES = {
  mouseButton:   // DEC SET: VT200 mouse (button press events)
  mouseDrag:     // DEC SET: BTN_EVENT (drag events)
  mouseMotion:   // DEC SET: ANY_EVENT (all motion)
  mouseSGR:      // DEC SET: SGR_EXT_MODE (extended coordinates)
}

ANSI_RESPONSE_PATTERNS = {
  sgrPattern: /\x1b\[<(\d+);(\d+);(\d+)([Mm])/,
  escPattern: /\x1b\[M([\x20-\x7f])([\x20-\x7f])([\x20-\x7f])/
}
```

### 3. Type System (`src/types/index.ts`)

Defines the TypeScript types used throughout the library.

#### Core Types

```typescript
// Union type for all button types
type ButtonType =
  'none' | 'left' | 'middle' | 'right' |
  'wheel-up' | 'wheel-down' | 'wheel-left' | 'wheel-right' |
  'back' | 'forward' | 'unknown';

// All possible mouse actions
type MouseEventAction =
  'move' | 'release' | 'press' | 'drag' | 'wheel' | 'click';

// Base event structure (all protocols)
type MouseEventBase = {
  x: number;           // Column position (1-indexed)
  y: number;           // Row position (1-indexed)
  button: ButtonType;
  action: MouseEventAction;
  shift: boolean;      // Shift key state
  alt: boolean;        // Alt key state
  ctrl: boolean;       // Ctrl key state
  raw: number;         // Raw button code for debugging
  data: string;        // Raw escape sequence
};

// Protocol-specific event types
type SGRMouseEvent = MouseEventBase & { protocol: 'SGR' };
type ESCMouseEvent = MouseEventBase & { protocol: 'ESC' };
type MouseEvent = SGRMouseEvent | ESCMouseEvent;
```

## Data Flow

### Event Processing Pipeline

```
Terminal User Action
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ Terminal emits ANSI escape sequence to stdout               │
│ Example: "\x1b[<0;12;34M" (SGR press at x=12, y=34)         │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ Mouse.handleEvent() receives Buffer via stdin 'data' event  │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ parseMouseEvents() parses the buffer string                 │
│ - Finds ESC sequences with \x1b[ prefix                     │
│ - Dispatches to SGR or ESC parser                           │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ Protocol parser decodes:                                    │
│ - Button code → button type + action                        │
│ - Extracts x, y coordinates                                 │
│ - Extracts modifier bits (Shift/Alt/Ctrl)                   │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ EventEmitter emits event by action name                     │
│ - emitter.emit('press', event)                              │
│ - emitter.emit('drag', event)                               │
│ - etc.                                                      │
└─────────────────────────────────────────────────────────────┘
       │
       ▼
┌─────────────────────────────────────────────────────────────┐
│ User callback executed (event-based API) OR                 │
│ Event queued for async generator (streaming API)            │
└─────────────────────────────────────────────────────────────┘
```

### Click Detection Algorithm

The library implements synthetic click detection by tracking press/release pairs:

```typescript
// On 'press' event
this.lastPress = event;

// On 'release' event
if (this.lastPress) {
  const xDiff = Math.abs(event.x - this.lastPress.x);
  const yDiff = Math.abs(event.y - this.lastPress.y);

  // Click if press and release are within 1 cell
  if (xDiff <= 1 && yDiff <= 1) {
    const clickEvent: MouseEvent = { ...event, action: 'click' };
    // Emit on next tick to avoid ordering issues
    process.nextTick(() => {
      this.emitter.emit('click', clickEvent);
    });
  }
  this.lastPress = null;
}
```

## Protocol Handling

### SGR (SGR-Style) Protocol

**Format:** `\x1b[<b;x;yM` (press) or `\x1b[<b;x;ym` (release)

**Button Encoding:**

| Code | Button | Notes |
|------|--------|-------|
| 0 | Left | Standard press |
| 1 | Middle | Standard press |
| 2 | Right | Standard press |
| 3 | Release | Button release |
| 64 | Wheel Up | Scroll up |
| 65 | Wheel Down | Scroll down |
| 66 | Wheel Left | Horizontal scroll |
| 67 | Wheel Right | Horizontal scroll |
| 128 | Back | Browser back button |
| 129 | Forward | Browser forward button |

**Modifier Bits:**
- Bit 4 (0x10): Ctrl
- Bit 3 (0x08): Alt
- Bit 2 (0x04): Shift
- Bit 5 (0x20): Motion flag (drag/move)

**Terminator:** `M` = press, `m` = release

### ESC (Legacy) Protocol

**Format:** `\x1b[Mbxy` (where b, x, y are single bytes + 32)

**Button Encoding:** Uses lower 2 bits for button ID
- Bits 0-1: Button (0=left, 1=middle, 2=right, 3=release)
- Bit 2: Shift
- Bit 3: Alt/Meta
- Bit 4: Ctrl
- Bit 5: Motion flag
- Bit 6: Wheel event flag

**Coordinate Encoding:** `charCode = coordinate + 32` (32 = space character)

**Limitation:** Maximum coordinates are 223 (255 - 32) due to single-byte encoding.

### Protocol Selection

The library supports both protocols simultaneously. Detection is automatic:

```typescript
if (data[i + 2] === '<') {
  // SGR protocol: \x1b[<...
  [event, nextIndex] = parseSGRMouseEvent(data, i);
} else if (data[i + 2] === 'M') {
  // ESC protocol: \x1b[M...
  [event, nextIndex] = parseESCMouseEvent(data, i);
}
```

## Event System

### Event-Based API

The `on()` and `off()` methods provide traditional EventEmitter-style registration:

```typescript
public on(event: MouseEventAction | 'error',
          listener: (event: MouseEvent) => void): EventEmitter
```

**Emitted Events:**
- `press` - Button pressed
- `release` - Button released
- `click` - Press + release within small area (synthetic)
- `drag` - Motion while button pressed
- `move` - Motion with no button pressed
- `wheel` - Scroll wheel rotation
- `error` - Parsing/handling errors

### Streaming API

#### `eventsOf(type, options)` - Single Event Type Stream

Returns an async generator yielding events of a specific type.

**Implementation Details:**

1. **Queue Management:**
   - Events stored in FIFO queue (max size configurable)
   - When `latestOnly: true`, only most recent event is kept
   - Oldest events dropped when queue is full

2. **Promise-based Coordination:**
   ```typescript
   // When event arrives
   if (resolveNext) {
     resolveNext(ev);  // Resolve pending Promise
   } else {
     queue.push(ev);   // Queue for later
   }

   // When waiting for next event
   yield await new Promise((resolve) => {
     resolveNext = resolve;
   });
   ```

3. **AbortSignal Support:**
   - Clean cancellation of async iteration
   - Removes event listeners on abort
   - Throws `MouseError` with abort message

#### `stream(options)` - All Events Stream

Similar to `eventsOf()`, but yields wrapped objects:
```typescript
{ type: MouseEventAction; event: MouseEvent }
```

Uses a `Map` to register handlers for all event types simultaneously.

## Design Patterns

### 1. Facade Pattern

The `Mouse` class provides a simplified interface to the complex terminal control and event parsing logic.

### 2. Generator Pattern

Async generators (`eventsOf`, `stream`) provide lazy, pull-based event consumption with built-in cleanup via `finally` blocks.

### 3. Observer Pattern

EventEmitter implementation allows multiple observers for each event type.

### 4. Strategy Pattern

Protocol detection and dispatch (SGR vs ESC) acts as a strategy pattern for parsing.

### 5. State Preservation

The `enable()` method saves original stream settings (`previousEncoding`, `previousRawMode`) to restore them in `disable()`, ensuring proper cleanup.

## Module Structure

```
src/
├── index.ts              # Public API exports
├── core/
│   ├── Mouse.ts          # Main Mouse class
│   └── Mouse.test.ts     # Unit tests
├── parser/
│   ├── ansiParser.ts     # Protocol parsing logic
│   ├── constants.ts      # ANSI codes and patterns
│   └── ansiParser.test.ts
└── types/
    └── index.ts          # TypeScript type definitions
```

### Dependencies

- **node:events** - EventEmitter for event system
- **process** - Standard I/O streams (stdin/stdout)
- **No external dependencies** - Pure Node.js standard library

## Build Output

The `dist/` directory contains the compiled output:

```
dist/
├── index.js         # ESM JavaScript output
├── index.d.ts       # TypeScript declarations
└── (source maps)    # Debug source maps
```

Built using [tsup](https://tsup.egoist.dev/) for fast, zero-config bundling.
