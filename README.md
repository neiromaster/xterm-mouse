# xterm-mouse - Bring mouse interaction to your Node.js terminal apps

> [!CAUTION]
> This library is currently in its early stages of development. It is provided "as is" and its use is at your own risk. We welcome contributions! Feel free to open issues or submit pull requests.

This library provides a simple way to capture and parse mouse events from xterm-compatible terminals in Node.js applications.

## Features

* Captures mouse events (clicks, drags, movements, wheel scrolls).
* Supports SGR and ESC mouse protocols.
* Provides parsed mouse event data including button, action, coordinates, and modifier keys (Shift, Alt, Ctrl).
* Offers a streaming API with `eventsOf`, `stream`, and `debouncedMoveEvents` methods for asynchronous iteration over mouse events.
* Includes debounced move event streaming for smooth animations and performance optimization.

## API

### Mouse Events

The `Mouse` instance emits the following events:

* `press`: A mouse button is pressed.
* `release`: A mouse button is released.
* `click`: A mouse button is pressed and released within a small area.
* `wheel`: The mouse wheel is scrolled.
* `move`: The mouse is moved.
* `drag`: The mouse is moved while a button is pressed.

### Event Object Structure

The event object passed to the event listeners has the following structure:

```typescript
{
  x: number, // The x coordinate of the mouse
  y: number, // The y coordinate of the mouse
  button: 'none' | 'left' | 'middle' | 'right' | 'wheel-up' | 'wheel-down' | 'wheel-left' | 'wheel-right' | 'back' | 'forward' | 'unknown', // The button that was pressed
  action: 'move' | 'release' | 'press' | 'drag' | 'wheel' | 'click', // The action that was performed
  shift: boolean, // Whether the shift key was pressed
  alt: boolean, // Whether the alt key was pressed
  ctrl: boolean, // Whether the ctrl key was pressed
  raw: number, // The raw event code
  data: string, // The raw event data
  protocol: 'SGR' | 'ESC' // The mouse protocol used
}
```

> [!NOTE]
> If the terminal does not support SGR mode, the coordinates are limited to a maximum of 95. This is a limitation of the older ESC-based protocol.

## Getting Started

### Checking Terminal Support

Before using mouse tracking, you can check if your terminal supports it:

```typescript
import { Mouse } from '@neiropacks/xterm-mouse';

// Simple boolean check
if (Mouse.isSupported()) {
  console.log('Mouse events are supported!');
} else {
  console.log('Mouse events not supported in this environment');
}

// Detailed check with specific reason
const result = Mouse.checkSupport();
if (result === Mouse.SupportCheckResult.Supported) {
  console.log('Mouse events are supported!');
} else if (result === Mouse.SupportCheckResult.NotTTY) {
  console.error('Not running in a terminal');
} else if (result === Mouse.SupportCheckResult.OutputNotTTY) {
  console.error('Output is not a terminal');
}
```

**Note:** `enable()` will throw an error if called in a non-TTY environment. Using these checks beforehand provides a better user experience.

### Installation

```bash
bun add @neiropacks/xterm-mouse
# or
npm install @neiropacks/xterm-mouse
# or
yarn add @neiropacks/xterm-mouse
```

### Usage

#### Basic Usage (Event-based)

```typescript
import { Mouse } from '@neiropacks/xterm-mouse';

const mouse = new Mouse();

console.log("Enabling mouse tracking... Press 'q' to exit.");

mouse.on('press', (event) => {
  console.log('Press event:', JSON.stringify(event));
});

mouse.on('click', (event) => {
  console.log('Click event:', JSON.stringify(event));
});

mouse.enable();

process.stdin.on('data', (data) => {
  if (data.toString() === 'q') {
    mouse.disable();
    process.exit();
  }
});
```

#### Interactive Visual Examples

The library includes several interactive examples demonstrating real-world terminal UI patterns with mouse interactions:

##### Interactive Buttons Demo

Demonstrates clickable buttons with visual feedback, hover effects, and click animations:

```bash
bun run dev:interactive-buttons
```

Features:

* Multiple clickable buttons with different colors
* Hover effects (highlight when mouse over)
* Click animation (visual feedback on press)
* Status bar showing current action

##### Interactive Menu Demo

Shows a menu with hover effects, selection highlighting, and keyboard navigation:

```bash
bun run dev:interactive-menu
```

Features:

* Menu items with hover highlight
* Click to select with visual feedback
* Description panel showing item details
* Keyboard navigation (↑/↓ arrows, Enter to select)

##### Interactive Grid Demo

Demonstrates a clickable grid with drag-to-paint functionality:

```bash
bun run dev:interactive-grid
```

Features:

* Grid of clickable cells (16×10)
* Click to toggle cell state
* Drag to paint multiple cells
* Color palette selection
* Real-time visual feedback

These examples demonstrate how to build interactive terminal UIs using:

* ANSI escape codes for cursor positioning
* Color and text styling for visual feedback
* Mouse events for interaction
* Real-time UI updates

#### TypeScript Type Inference

The library provides advanced TypeScript type inference for event handlers. The `on()` and `off()` methods automatically infer the correct event type based on the event name:

```typescript
import { Mouse } from '@neiropacks/xterm-mouse';

const mouse = new Mouse();
mouse.enable();

// TypeScript knows event.button is 'wheel-up' | 'wheel-down' | 'wheel-left' | 'wheel-right'
mouse.on('wheel', (event) => {
  console.log(event.button); // Type: 'wheel-up' | 'wheel-down' | 'wheel-left' | 'wheel-right'
});

// TypeScript knows event.button is 'none'
mouse.on('move', (event) => {
  console.log(event.button); // Type: 'none'
});

// TypeScript knows event.button excludes wheel buttons
mouse.on('drag', (event) => {
  console.log(event.button); // Type: 'left' | 'middle' | 'right' | 'back' | 'forward'
});
```

This type inference improves developer experience by:

* **Better IntelliSense**: Autocomplete shows only valid button types for each event
* **Early Error Detection**: TypeScript catches type mismatches at compile time
* **Self-Documenting Code**: Event types are clear from the handler signature

### One-Time Event Listeners

For scenarios where you only need to handle a single event, use the `once()` method. The listener automatically removes itself after the first invocation, preventing memory leaks and eliminating manual cleanup:

```typescript
import { Mouse } from '@neiropacks/xterm-mouse';

const mouse = new Mouse();
mouse.enable();

// Wait for a single click
mouse.once('click', (event) => {
  console.log('Got one click!', event);
  // Listener is automatically removed after this execution
});

// Listen for first wheel event only
mouse.once('wheel', (event) => {
  console.log(`Scrolled: ${event.button}`);
});
```

**Before** (manual cleanup required):

```typescript
const handler = (event) => {
  console.log('Got click', event);
  mouse.off('click', handler); // Manual cleanup
  // continue logic...
};
mouse.on('click', handler);
```

**After** (automatic cleanup):

```typescript
mouse.once('click', (event) => {
  console.log('Got click', event);
  // continue logic... listener already removed
});
```

The `once()` method provides the same type inference as `on()`, so TypeScript knows the exact event type for each event name.

#### Streaming API Usage

```typescript
import { Mouse } from '@neiropacks/xterm-mouse';

const mouse = new Mouse();

const main = async (): Promise<void> => {
  console.log('Enable mouse events...');
  mouse.enable();

  console.log('Starting to stream all mouse events. Press \'q\' to stop.');

  // Example of using the stream() method
  const streamPromise = (async (): Promise<void> => {
    for await (const { type, event } of mouse.stream()) {
      console.log(`Stream Event: type=${type}, event=${JSON.stringify(event)}`);
    }
  })();

  // Example of using the eventsOf() method for a specific event type
  const eventsOfPromise = (async (): Promise<void> => {
    for await (const event of mouse.eventsOf('press')) {
      console.log(`eventsOf('press') Event: ${JSON.stringify(event)}`);
    }
  })();

  // Keep the script running until a key is pressed.
  process.stdin.on('data', (data) => {
    if (data.toString() === 'q') {
      console.log('Disabling mouse events...');
      mouse.disable();
      process.exit(0);
    }
  });
};

main().catch(console.error);
```

#### Debounced Move Events

For smooth animations and performance optimization, use the `debouncedMoveEvents()` method to receive move events at a controlled rate. Unlike `eventsOf('move')` which yields every move event, `debouncedMoveEvents()` waits for a quiet period before emitting, ensuring you only get events at a controlled rate.

```typescript
import { Mouse } from '@neiropacks/xterm-mouse';

const mouse = new Mouse();

const main = async (): Promise<void> => {
  console.log('Enable mouse events...');
  mouse.enable();

  console.log('Tracking mouse position at 60fps. Press \'q\' to stop.');

  // Track mouse position with debouncing (~60fps by default)
  for await (const event of mouse.debouncedMoveEvents()) {
    console.log(`Mouse position: x=${event.x}, y=${event.y}`);
  }
};

main().catch(console.error);

process.stdin.on('data', (data) => {
  if (data.toString() === 'q') {
    mouse.disable();
    process.exit(0);
  }
});
```

**Use Cases:**

* **Smooth animations**: Update UI at a consistent frame rate without excessive redraws
* **Position tracking**: Get the latest mouse position without processing every intermediate event
* **Performance optimization**: Reduce event handling overhead for high-frequency move events

**Configuration:**

```typescript
// Custom interval (30fps for less frequent updates)
for await (const event of mouse.debouncedMoveEvents({ interval: 33 })) {
  updateUI(event.x, event.y);
}

// With cancellation
const controller = new AbortController();
setTimeout(() => controller.abort(), 10000);

try {
  for await (const event of mouse.debouncedMoveEvents({ signal: controller.signal })) {
    renderFrame(event.x, event.y);
  }
} catch (err) {
  if (err.message.includes('aborted')) {
    console.log('Tracking stopped');
  }
}
```

**Debouncing Behavior:**

* Move events are collected during the debounce interval
* Only the most recent event is yielded after the interval elapses
* If the mouse continues moving, the timer restarts with each new event
* Default interval is 16ms (~60fps) for smooth animations

**Comparison: Raw vs Debounced:**

```typescript
// Raw: Can fire hundreds of times per second
for await (const event of mouse.eventsOf('move')) {
  console.log('Raw move'); // May print too fast to read
  if (event.x > 50) break;
}

// Debounced: Controlled rate, easier to process
for await (const event of mouse.debouncedMoveEvents({ interval: 100 })) {
  console.log('Debounced move'); // Prints at most 10 times per second
  if (event.x > 50) break;
}
```

### Advanced Async Iterator Control

The `stream()` and `eventsOf()` methods accept an options object for more advanced control over the async iterators.

#### Cancelling with AbortSignal

You can provide an `AbortSignal` to gracefully terminate an async iterator. This is useful for cleanup and resource management, especially in long-running applications.

```typescript
import { Mouse } from '@neiropacks/xterm-mouse';

const mouse = new Mouse();
const controller = new AbortController();

const main = async (): Promise<void> => {
  mouse.enable();

  console.log('Streaming press events for 5 seconds...');

  try {
    for await (const event of mouse.eventsOf('press', { signal: controller.signal })) {
      console.log(`Press event: ${JSON.stringify(event)}`);
    }
  } catch (error) {
    // The AbortError will be thrown here when the signal is aborted.
    console.log('Stream was cancelled.', error.message);
  }
};

main().catch(console.error);

// Stop the stream after 5 seconds.
setTimeout(() => {
  controller.abort();
  mouse.disable();
}, 5000);
```

#### Performance Tuning

The options object also allows you to control the behavior of the event queue:

* `maxQueue: number` (default: `100`)
    The maximum number of events to hold in the queue. If the queue is full and a new event arrives, the oldest event is dropped. This prevents memory leaks in scenarios with high event throughput.

* `latestOnly: boolean` (default: `false`)
    If set to `true`, the queue will only store the most recent event, discarding any previous ones. This is useful when you only care about the latest state (e.g., for mouse position) and not the intermediate events.

### Configuring Click Detection

By default, a click is detected when the mouse button press and release occur within 1 cell in both the X and Y directions. You can customize this behavior using the `clickDistanceThreshold` option.

#### Default Behavior

The default threshold of 1 allows for slight movement between press and release:

```typescript
import { Mouse } from '@neiropacks/xterm-mouse';

const mouse = new Mouse(); // Uses default threshold of 1
```

#### Strict Click Detection

For applications that require precise clicks, set the threshold to 0 to require the press and release to occur at the exact same position:

```typescript
import { Mouse } from '@neiropacks/xterm-mouse';

const mouse = new Mouse(process.stdin, process.stdout, undefined, {
  clickDistanceThreshold: 0, // Require exact position
});
```

For better type safety, you can explicitly type the options object:

```typescript
import { Mouse, MouseOptions } from '@neiropacks/xterm-mouse';

const options: MouseOptions = {
  clickDistanceThreshold: 0,
};

const mouse = new Mouse(process.stdin, process.stdout, undefined, options);
```

#### Lenient Click Detection

For applications that can tolerate more movement, increase the threshold:

```typescript
import { Mouse } from '@neiropacks/xterm-mouse';

const mouse = new Mouse(process.stdin, process.stdout, undefined, {
  clickDistanceThreshold: 5, // Allow up to 5 cells of movement
});
```

### Convenience Methods

For common interaction patterns, the library provides promise-based helper methods that wrap the streaming API into simpler, more convenient functions.

#### waitForClick()

Wait for a single click event:

```typescript
import { Mouse } from '@neiropacks/xterm-mouse';

const mouse = new Mouse();
mouse.enable();

try {
  const click = await mouse.waitForClick();
  console.log(`Clicked at ${click.x}, ${click.y} with ${click.button}`);
} finally {
  mouse.disable();
}
```

With custom timeout:

```typescript
const click = await mouse.waitForClick({ timeout: 5000 });
```

With cancellation:

```typescript
const controller = new AbortController();
setTimeout(() => controller.abort(), 1000);

try {
  const click = await mouse.waitForClick({ signal: controller.signal });
} catch (err) {
  if (err.message.includes('aborted')) {
    console.log('Wait cancelled');
  }
}
```

#### waitForInput()

Wait for any mouse input event (press, release, click, drag, wheel, or move):

```typescript
import { Mouse } from '@neiropacks/xterm-mouse';

const mouse = new Mouse();
mouse.enable();

console.log('Move mouse or click to continue...');
const event = await mouse.waitForInput();
console.log(`Got ${event.action} at ${event.x}, ${event.y}`);

mouse.disable();
```

This is useful for "press any key to continue" style interactions, but with mouse events instead.

#### getMousePosition()

Get the current mouse position, returning immediately if cached:

```typescript
import { Mouse } from '@neiropacks/xterm-mouse';

const mouse = new Mouse();
mouse.enable();

// Returns cached position immediately, or waits for first move
const { x, y } = await mouse.getMousePosition();
console.log(`Mouse at ${x}, ${y}`);

mouse.disable();
```

The method maintains an internal cache of the last position from move or drag events:

* Returns cached position **immediately** if available
* Waits for next move event only if no movement has occurred yet
* Supports custom timeout and AbortSignal for cancellation

```typescript
// With custom timeout
const { x, y } = await mouse.getMousePosition({ timeout: 5000 });

// With cancellation
const controller = new AbortController();
setTimeout(() => controller.abort(), 3000);

try {
  const { x, y } = await mouse.getMousePosition({ signal: controller.signal });
} catch (err) {
  console.log('Cancelled');
}
```

#### getLastPosition()

Get the last known mouse position **synchronously** without waiting:

```typescript
const mouse = new Mouse();
mouse.enable();

// Returns null if no movement yet
const pos = mouse.getLastPosition();
if (pos) {
  console.log(`Last position: ${pos.x}, ${pos.y}`);
} else {
  console.log('No movement yet');
}

// Use in event handlers (no await needed)
mouse.on('move', () => {
  const pos = mouse.getLastPosition();
  console.log(`Current: ${pos?.x}, ${pos?.y}`);
});
```

**Key differences:**

| Method               | Returns              | Waits for event   | Use case                  |
|----------------------|----------------------|-------------------|---------------------------|
| `getLastPosition()`  | `{x, y} \| null`     | No (instant)      | Immediate position access |
| `getMousePosition()` | `Promise<{x, y}>`    | Yes (if no cache) | Guaranteed position       |

## Troubleshooting

### Mouse events not working

If mouse events are not being captured:

* **Check terminal compatibility**: Ensure your terminal supports xterm mouse tracking. Most modern terminals (iTerm2, GNOME Terminal, Windows Terminal, etc.) support this feature, but it may need to be enabled in terminal settings.

* **Verify stdin is in raw mode**: The library automatically sets stdin to raw mode when `enable()` is called. If you're manually manipulating stdin, it may interfere with mouse event capture.

* **Check for conflicting libraries**: Other terminal manipulation libraries (e.g., readline, prompt libraries) may interfere with mouse tracking. Try disabling them to see if mouse events start working.

### Coordinate limitations

If you're experiencing coordinate issues (e.g., coordinates never exceed 95):

* **ESC protocol limitation**: Your terminal may not support SGR mode. The older ESC protocol limits coordinates to 223 (0-indexed: 222), but some terminals may have further restrictions.

* **Terminal window size**: Coordinates are relative to the terminal window size. Ensure you're testing in a terminal with sufficient size.

### Events not firing

If event listeners are not being triggered:

* **Verify enable() was called**: Make sure you've called `mouse.enable()` before attempting to capture mouse events.

* **Check event type**: Ensure you're listening for the correct event type. See the [Mouse Events](#mouse-events) section for available event types.

* **Process stdin**: Ensure `process.stdin` is not being paused or redirected. The library relies on stdin to receive mouse events.

### Cleanup issues

If you're experiencing issues with mouse tracking not disabling properly:

* **Always call disable()**: Ensure you're calling `mouse.disable()` before your program exits. This restores the terminal to its original state.

* **Handle process exit**: Register an exit handler to ensure cleanup:

```typescript
process.on('exit', () => {
  mouse.disable();
});

process.on('SIGINT', () => {
  mouse.disable();
  process.exit();
});
```

### No wheel events

If mouse wheel events are not being captured:

* **Terminal support**: Some terminals may not support wheel events in the default mode. The library attempts to enable wheel tracking, but terminal limitations may prevent this.

* **Scrolling vs wheel**: Wheel events are distinct from terminal scrolling. Ensure you're actually using the mouse wheel, not the terminal's scrollback feature.

### Coordinate offset issues

If mouse coordinates appear offset or incorrect:

* **Terminal padding**: Some terminals have padding or margins that can affect coordinate calculation. This is a terminal-specific behavior.

* **Multi-line prompts**: If your application has multi-line output before the mouse interaction area, coordinates will be relative to the entire terminal buffer, not your application's visible area.

## For Developers

### Project Status

This library is currently in its early stages of development. While efforts are made to ensure stability and correctness, it is provided "as is" and its use is at your own risk. We welcome contributions! Feel free to open issues or submit pull requests.

### Available Commands

**Development:**

* **`bun run build`**: Compiles the TypeScript code into JavaScript and generates type declaration files.
* **`bun run typecheck`**: Type checks the code without emitting output.
* **`bun run test`**: Runs all tests.
* **`bun run coverage`**: Runs tests with coverage report.

**Code Quality:**

* **`bun run lint`**: Runs Biome, dprint, and markdownlint checks.
* **`bun run lint:md`**: Runs markdownlint checks only.
* **`bun run format`**: Formats code using Biome, dprint, and markdownlint.
* **`bun run format:md`**: Formats markdown files using markdownlint.

**Examples:**

* **`bun run dev:basic`**: Runs the basic example with hot-reloading.
* **`bun run dev:streaming`**: Runs the streaming example with hot-reloading.
* **`bun run dev:custom-threshold`**: Runs the custom threshold example with hot-reloading.
* **`bun run dev:pause-resume`**: Runs the pause/resume example with hot-reloading.
* **`bun run dev:interactive-buttons`**: Runs the interactive buttons demo.
* **`bun run dev:interactive-menu`**: Runs the interactive menu demo.
* **`bun run dev:interactive-grid`**: Runs the interactive grid demo.
