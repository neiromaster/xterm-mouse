# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is a TypeScript library for capturing and parsing mouse events from xterm-compatible terminals in Node.js applications. It provides both event-based (EventEmitter) and streaming (async generators) APIs for handling terminal mouse interactions.

**Key Architecture:**

- **Mouse class** (`src/core/Mouse.ts`): Main class that manages mouse event tracking, handles stdin/stdout streams, and emits events
- **ANSI Parser** (`src/parser/`): Parses raw ANSI escape sequences into structured mouse events
  - Supports both SGR (modern) and ESC (legacy) mouse protocols
  - Implements run-length deduplication to avoid duplicate events
- **Types** (`src/types/index.ts`): Discriminated union types for mouse events with protocol-specific variants

## Common Commands

### Building

```bash
bun run build          # Build using tsup (bundles ESM output to dist/)
```

### Testing

```bash
bun test               # Run all tests
bun run coverage       # Run tests with coverage report
```

### Code Quality

```bash
bun run lint           # Check code with Biome and dprint
bun run format         # Format code with Biome and dprint
bun run typecheck      # Type check with TypeScript
```

### Development

```bash
bun run dev:basic         # Run basic example with hot-reload
bun run dev:streaming     # Run streaming example with hot-reload
```

## Architecture Details

### Terminal Capability Detection

The `Mouse` class provides static methods to check terminal support before enabling mouse tracking:

- **`Mouse.isSupported()`**: Returns `true` if both `process.stdin.isTTY` and `process.stdout.isTTY` are true
- **`Mouse.checkSupport()`**: Returns detailed status from `Mouse.SupportCheckResult` enum:
  - `Supported` - Terminal supports mouse events
  - `NotTTY` - Input stream is not a TTY
  - `OutputNotTTY` - Output stream is not a TTY

This provides better UX than catching exceptions from `enable()` in non-TTY environments (CI, piped input, IDE terminals).

### Mouse Event Flow

1. `Mouse.enable()` puts stdin in raw mode and sends ANSI codes to enable terminal mouse tracking
2. Raw stdin data is received and parsed by `parseMouseEvents()` from the ANSI parser
3. Parsed events are emitted through an EventEmitter or yielded via async generators
4. `Mouse.disable()` restores terminal state and sends ANSI codes to disable tracking

### Protocol Support

- **SGR Protocol** (`\x1b[<Cb;Cx;CyM` or `\x1b[<Cb;Cx;Cym`): Modern protocol with unlimited coordinates and clear press/release encoding
- **ESC Protocol** (`\x1b[MCbCxCy`): Legacy protocol with coordinate limits (max 223, sometimes 95)

The parser automatically detects which protocol is being used and returns a discriminated union type (`SGRMouseEvent | ESCMouseEvent`).

### Event Types

- `press`: Mouse button pressed
- `release`: Mouse button released
- `click`: Synthesized when press and release occur within `clickDistanceThreshold` (default: 1 cell)
- `drag`: Mouse moved while button pressed
- `move`: Mouse moved without button pressed
- `wheel`: Mouse wheel scrolled

### Resource Management

The library uses **FinalizationRegistry** for automatic cleanup on garbage collection:

- If a Mouse instance is GC'd without explicit cleanup, stdin listeners are removed automatically
- Despite this safety net, **always call `destroy()`** when done with a Mouse instance for immediate cleanup
- `pause()`/`resume()` provide fast event throttling without terminal state changes

### Streaming API

The `eventsOf()` and `stream()` methods return async generators with:

- AbortSignal support for cancellation
- Configurable queue size (`maxQueue`, default: 100, max: 1000)
- `latestOnly` mode for high-frequency events (keeps only newest event)
- Automatic listener cleanup on abort, completion, or error

### TypeScript Type Inference

The library provides advanced type inference for event handlers through discriminated union types:

- **`EventByAction<T>`**: Maps event action to specific event type with narrowed button types
  - `'wheel'` → `button: 'wheel-up' | 'wheel-down' | 'wheel-left' | 'wheel-right'`
  - `'move'` → `button: 'none'`
  - `'drag'` → `button: 'left' | 'middle' | 'right' | 'back' | 'forward'`
  - `'press' | 'release' | 'click'` → `button: ButtonType` (all buttons)

- **`TypedEventListener<T>`**: Type-safe listener with inferred event parameter type
- **`ListenerFor<T>`**: Extracts listener type for a given event name
- **`EventTypeFor<T>`**: Extracts event type for a given event name

The `Mouse.on()` and `Mouse.off()` methods use these utilities to provide type-safe event handling:

```typescript
mouse.on('wheel', (event) => {
  // TypeScript knows event.button is 'wheel-up' | 'wheel-down' | 'wheel-left' | 'wheel-right'
  console.log(event.button);
});
```

Type inference utilities are exported from `src/types/eventHandler.ts` and re-exported from `src/types/index.ts`.

## Code Organization

```
src/
├── index.ts           # Public API exports
├── core/
│   ├── Mouse.ts       # Main Mouse class implementation
│   └── Mouse.test.ts  # Mouse class tests
├── parser/
│   ├── ansiParser.ts  # ANSI escape sequence parser
│   ├── ansiParser.test.ts
│   └── constants.ts   # ANSI codes and regex patterns
└── types/
    ├── index.ts       # Type definitions barrel export
    ├── action.ts      # MouseEventAction type
    ├── button.ts      # ButtonType union
    ├── event.ts       # MouseEvent discriminated union
    ├── eventHandler.ts  # Type inference utilities (EventByAction, TypedEventListener, etc.)
    ├── eventHandler.test.ts  # Type inference tests
    ├── options.ts     # MouseOptions interface
    ├── error.ts       # MouseError class
    └── stream.ts      # ReadableStreamWithEncoding type
```

## Testing Approach

- Uses `bun test` for all testing
- Tests are co-located with source files (`.test.ts` suffix)
- The `Mouse` class requires a TTY for integration tests - unit tests mock stdin/stdout
- Run examples in a real terminal to verify mouse tracking behavior

## Development Notes

- **Bun is the default runtime** (not Node.js)
- Use `bun <file>` instead of `node <file>`
- Use `bun test` instead of `jest` or `vitest`
- The library is ESM-only (`"type": "module"` in package.json)
- Terminal mouse tracking **requires a TTY** - won't work in piped/non-interactive environments
- **Check support before enabling**: Use `Mouse.isSupported()` or `Mouse.checkSupport()` to verify terminal capabilities before calling `mouse.enable()`
- The `click` event is synthesized from `press` + `release` events, not directly from the terminal
