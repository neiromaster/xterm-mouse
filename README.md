# xterm-mouse - Bring mouse interaction to your Node.js terminal apps.

> [!CAUTION]
> This library is currently in its early stages of development. It is provided "as is" and its use is at your own risk. We welcome contributions! Feel free to open issues or submit pull requests.

This library provides a simple way to capture and parse mouse events from xterm-compatible terminals in Node.js applications.

## Features

*   Captures mouse events (clicks, drags, movements, wheel scrolls).
*   Supports SGR and ESC mouse protocols.
*   Provides parsed mouse event data including button, action, coordinates, and modifier keys (Shift, Alt, Ctrl).
*   Offers a streaming API with `eventsOf` and `stream` methods for asynchronous iteration over mouse events.

## API

### Mouse Events

The `Mouse` instance emits the following events:

*   `press`: A mouse button is pressed.
*   `release`: A mouse button is released.
*   `click`: A mouse button is pressed and released within a small area.
*   `wheel`: The mouse wheel is scrolled.
*   `move`: The mouse is moved.
*   `drag`: The mouse is moved while a button is pressed.

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

*   `maxQueue: number` (default: `100`)
    The maximum number of events to hold in the queue. If the queue is full and a new event arrives, the oldest event is dropped. This prevents memory leaks in scenarios with high event throughput.

*   `latestOnly: boolean` (default: `false`)
    If set to `true`, the queue will only store the most recent event, discarding any previous ones. This is useful when you only care about the latest state (e.g., for mouse position) and not the intermediate events.

## For Developers

### Project Status

This library is currently in its early stages of development. While efforts are made to ensure stability and correctness, it is provided "as is" and its use is at your own risk. We welcome contributions! Feel free to open issues or submit pull requests.

### Available Commands

*   **`bun run build`**: Compiles the TypeScript code into JavaScript and generates type declaration files.
*   **`bun run lint`**: Runs ESLint and Biome checks to identify code quality issues.
*   **`bun run format`**: Formats the code using Biome and applies ESLint fixes.
*   **`bun run lint:fix`**: Applies ESLint fixes to the codebase.
*   **`bun run biome:check`**: Runs Biome checks and applies unsafe fixes.
*   **`bun run dev:basic`**: Runs the basic example with hot-reloading.
*   **`bun run dev:streaming`**: Runs the streaming example with hot-reloading.
