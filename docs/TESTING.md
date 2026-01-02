# Testing Guidelines - xterm-mouse Testing Documentation

> [!NOTE]
> This document describes the testing conventions and guidelines for contributors to xterm-mouse.

## Table of Contents

- [Overview](#overview)
- [Running Tests](#running-tests)
- [Test Framework](#test-framework)
- [Test Structure](#test-structure)
- [Testing Patterns](#testing-patterns)
- [Coverage](#coverage)
- [Writing New Tests](#writing-new-tests)

## Overview

xterm-mouse uses **Bun's built-in test runner** (`bun test`) for all testing. Tests are located alongside the source files they test, following the co-location pattern with `.test.ts` suffix.

```
src/
├── core/
│   ├── Mouse.ts
│   └── Mouse.test.ts     # Tests for Mouse class
├── parser/
│   ├── ansiParser.ts
│   └── ansiParser.test.ts # Tests for parser
└── types/
    └── index.ts
```

## Running Tests

### Run All Tests

```bash
bun test
```

### Run Specific Test File

```bash
bun test src/core/Mouse.test.ts
```

### Run with Coverage

```bash
bun test --coverage
```

### Watch Mode

For development, use `--watch` for automatic re-running on file changes:

```bash
bun test --watch
```

## Test Framework

We use **Bun's native test runner**, which provides:

- **Fast test execution** - Tests run in parallel by default
- **Built-in assertions** - `expect()` API compatible with Jest
- **Mocking support** - `mock()`, `spy()` functions
- **Test organization** - `test()`, `describe()` blocks
- **Async/await support** - Native Promise handling

### Available Test Utilities

```typescript
import { test, expect, describe, mock } from 'bun:test';
```

| Function | Purpose |
|----------|---------|
| `test(name, fn)` | Define a test case |
| `describe(name, fn)` | Group related tests |
| `expect(value)` | Assert conditions |
| `mock(fn)` | Create a mock function |
| `expect.assertions()` | Verify assertion count |

## Test Structure

### AAA Pattern

Tests follow the **Arrange-Act-Assert (AAA)** pattern for clarity:

```typescript
test('Mouse should emit press event', async () => {
  // Arrange: Set up test data and dependencies
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';

  const eventPromise = new Promise<void>((resolve) => {
    mouse.on('press', (event) => {
      // Assert: Verify expected behavior
      expect(event.action).toBe('press');
      expect(event.button).toBe('left');
      expect(event.x).toBe(10);
      expect(event.y).toBe(20);
      resolve();
    });
  });

  // Act: Execute the code being tested
  mouse.enable();
  stream.emit('data', Buffer.from(pressEvent));

  await eventPromise;

  // Cleanup: Release resources
  mouse.destroy();
});
```

### Test Cleanup

Always clean up resources to prevent test interference:

```typescript
test('Mouse eventsOf should yield mouse events', async () => {
  const mouse = new Mouse(makeFakeTTYStream());
  const iterator = mouse.eventsOf('press');

  try {
    mouse.enable();
    // ... test code ...
  } finally {
    // Always cleanup, even if test fails
    await iterator.return(undefined);
    mouse.destroy();
  }
});
```

## Testing Patterns

### 1. Fake TTY Streams

For testing terminal interaction, create fake TTY streams:

```typescript
function makeFakeTTYStream(): ReadableStreamWithEncoding {
  const fake = new EventEmitter() as ReadableStreamWithEncoding;
  fake.isTTY = true;
  fake.isRaw = false;
  let encoding: BufferEncoding | null = null;

  fake.setRawMode = (mode: boolean): ReadableStreamWithEncoding => {
    fake.isRaw = mode;
    return fake;
  };

  fake.setEncoding = (enc: BufferEncoding): ReadableStreamWithEncoding => {
    encoding = enc;
    return fake;
  };

  fake.resume = (): ReadableStreamWithEncoding => fake;
  fake.pause = (): ReadableStreamWithEncoding => fake;

  return fake;
}
```

### 2. Event-Driven Tests

For event-based APIs, use Promises to wait for events:

```typescript
test('Mouse should emit click event', async () => {
  const mouse = new Mouse(makeFakeTTYStream());

  const eventPromise = new Promise<void>((resolve) => {
    mouse.on('click', (event) => {
      expect(event.action).toBe('click');
      resolve();
    });
  });

  mouse.enable();
  stream.emit('data', Buffer.from(pressEvent));
  stream.emit('data', Buffer.from(releaseEvent));

  await eventPromise;
  mouse.destroy();
});
```

### 3. Async Iterator Tests

For streaming APIs, test async generators properly:

```typescript
test('Mouse eventsOf should yield mouse events', async () => {
  const mouse = new Mouse(makeFakeTTYStream());
  const iterator = mouse.eventsOf('press');

  try {
    mouse.enable();

    // Start the async generator
    const eventPromise = iterator.next();
    stream.emit('data', Buffer.from('\x1b[<0;10;20M'));
    const { value } = await eventPromise;

    expect(value.action).toBe('press');
    expect(value.button).toBe('left');
  } finally {
    await iterator.return(undefined);
    mouse.destroy();
  }
});
```

### 4. Error Testing

Test error conditions with `toThrow()`:

```typescript
test('Mouse enable should throw error when inputStream is not TTY', () => {
  const nonTTYStream = new EventEmitter() as ReadableStreamWithEncoding;
  nonTTYStream.isTTY = false;

  const mouse = new Mouse(nonTTYStream);

  expect(() => {
    mouse.enable();
  }).toThrow('Mouse events require a TTY input stream');

  mouse.destroy();
});
```

### 5. Mock Functions

Use mocks to verify function calls:

```typescript
test('Mouse should not emit click event if distance is too large', async () => {
  const mouse = new Mouse(makeFakeTTYStream());
  const clickSpy = mock(() => {});

  mouse.on('click', clickSpy);

  mouse.enable();
  stream.emit('data', Buffer.from(pressEvent));
  stream.emit('data', Buffer.from(releaseEvent));

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy).not.toHaveBeenCalled();

  mouse.destroy();
});
```

### 6. Performance Tests

For performance-sensitive code, use thresholds:

```typescript
test('Mouse.stream() should handle high event volume', async () => {
  const mouse = new Mouse(makeFakeTTYStream());
  const iterator = mouse.stream();
  const eventCount = 10_000;
  const timeThreshold = 1000;

  try {
    mouse.enable();

    const startTime = performance.now();

    // Consume events
    for await (const _ of iterator) {
      // ...
    }

    const duration = performance.now() - startTime;
    expect(duration).toBeLessThan(timeThreshold);
  } finally {
    await iterator.return(undefined);
    mouse.destroy();
  }
}, 15000); // Increase timeout for performance tests
```

### 7. AbortSignal Testing

Test cancellable operations:

```typescript
test('Mouse.eventsOf() should be cancellable with AbortSignal', async () => {
  const mouse = new Mouse(makeFakeTTYStream());
  const controller = new AbortController();
  const iterator = mouse.eventsOf('press', { signal: controller.signal });

  try {
    mouse.enable();

    const promise = iterator.next();
    controller.abort();

    await expect(promise).rejects.toThrow('The operation was aborted.');
  } finally {
    mouse.destroy();
  }
});
```

## Coverage

### Coverage Goals

- **Core functionality**: 100% coverage (Mouse class, parser)
- **Edge cases**: Test all error branches
- **Protocol support**: Test both SGR and ESC protocols

### Current Coverage Status

Run coverage report:

```bash
bun test --coverage
```

Coverage is tracked in the build progress. Aim for high coverage on critical paths like:

- Event parsing and decoding
- Error handling
- Stream enable/disable lifecycle
- Async iterator cleanup

## Writing New Tests

### When to Add Tests

1. **New features** - Write tests before implementing (TDD) or alongside
2. **Bug fixes** - Add regression tests for fixed bugs
3. **Edge cases** - Test boundary conditions and error paths
4. **Protocols** - Test both SGR and ESC protocol variations

### Test Naming Convention

Use descriptive names that explain what is being tested:

```typescript
// Good
test('Mouse should emit press event', () => { });
test('Mouse should handle queue overflow', () => { });
test('parseMouseEvents should return an empty array for invalid input', () => { });

// Avoid
test('works', () => { });
test('test1', () => { });
```

### Test Data Constants

Define test constants at the top of test files for reusability:

```typescript
// Test data
const SGR_PRESS_LEFT = '\x1b[<0;10;20M';
const SGR_PRESS_MIDDLE = '\x1b[<1;10;20M';
const SGR_RELEASE_LEFT = '\x1b[<0;10;20m';
const SGR_DRAG_LEFT = '\x1b[<32;10;20M';

const ESC_PRESS_LEFT = '\x1b[M #4';
const ESC_RELEASE = '\x1b[M##4';
```

### Grouping Tests with `describe`

Use `describe()` to group related tests:

```typescript
describe('Coverage-specific tests', () => {
  test('should parse SGR right-click', () => { });
  test('should parse SGR back button', () => { });
  test('should handle unknown SGR button', () => { });
});
```

## Common Test Scenarios

### Mouse Event Sequences

```typescript
// Press event
'\x1b[<0;10;20M'    // SGR: left button press at x=10, y=20

// Release event
'\x1b[<0;10;20m'    // SGR: left button release

// Click detection (press + release)
const pressEvent = '\x1b[<0;10;20M';
const releaseEvent = '\x1b[<0;10;20m';
```

### Modifier Keys

```typescript
// With Shift, Alt, Ctrl modifiers
// SGR: button code with modifier bits set
'\x1b[<16;10;20M'   // Left + Shift
'\x1b[<8;10;20M'    // Left + Alt
'\x1b[<10;10;20M'   // Left + Shift + Ctrl
```

### Wheel Events

```typescript
const SGR_WHEEL_UP = '\x1b[<64;10;20M';
const SGR_WHEEL_DOWN = '\x1b[<65;10;20M';
const SGR_WHEEL_LEFT = '\x1b[<66;10;20M';
const SGR_WHEEL_RIGHT = '\x1b[<67;10;20M';
```

## Quality Checklist

Before submitting tests, ensure:

- [ ] All tests pass with `bun test`
- [ ] Test name clearly describes what is being tested
- [ ] AAA pattern is followed (Arrange-Act-Assert)
- [ ] Resources are cleaned up (even on failure)
- [ ] Edge cases are covered
- [ ] Error conditions are tested
- [ ] No `console.log` debugging statements left in tests
- [ ] Tests are deterministic (no random failures)
- [ ] Tests run in isolation (no dependencies on test order)
- [ ] Performance tests have appropriate timeouts

## Additional Resources

- [Bun Test Documentation](https://bun.sh/docs/test)
- [Project README](../README.md)
- [Architecture Documentation](./ARCHITECTURE.md)
