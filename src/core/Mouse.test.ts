import { expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';

import type { ReadableStreamWithEncoding } from '../types';

import { Mouse } from './Mouse';

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

  fake.readableEncoding = encoding;

  fake.resume = (): ReadableStreamWithEncoding => fake;
  fake.pause = (): ReadableStreamWithEncoding => fake;

  // Preserve original EventEmitter methods for proper event handling
  const originalOn = fake.on.bind(fake);
  const originalOff = fake.off.bind(fake);

  // biome-ignore lint/suspicious/noExplicitAny: original EventEmitter methods
  fake.on = (event: string, listener: (...args: any[]) => void): ReadableStreamWithEncoding => {
    originalOn(event, listener);
    return fake;
  };

  fake.off = (event: string, listener: (...args: unknown[]) => void): ReadableStreamWithEncoding => {
    originalOff(event, listener);
    return fake;
  };

  return fake;
}

test('Mouse should be instantiable', () => {
  // Arrange
  const mouse = new Mouse();
  // Act

  // Assert
  expect(mouse).toBeInstanceOf(Mouse);

  // Cleanup
  mouse.destroy();
});

test('Mouse enable/disable should work', () => {
  // Arrange
  const mouse = new Mouse(makeFakeTTYStream());

  // Act
  mouse.enable();

  // Assert
  expect(mouse.isEnabled()).toBe(true);

  // Act
  mouse.disable();

  // Assert
  expect(mouse.isEnabled()).toBe(false);
});

test('Mouse should emit press event', (done) => {
  // Arrange
  const emitter = new EventEmitter();
  const mouse = new Mouse(makeFakeTTYStream(), process.stdout, emitter);

  // Act
  mouse.on('press', (event) => {
    // Assert
    expect(event.action).toBe('press');
    expect(event.button).toBe('left');
    mouse.destroy();
    done();
  });

  mouse.enable();
  // Simulate a mouse press event
  emitter.emit('press', { action: 'press', button: 'left' });
});

test('Mouse should handle data events', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';

  const eventPromise = new Promise<void>((resolve) => {
    mouse.on('press', (event) => {
      // Assert
      expect(event.action).toBe('press');
      expect(event.button).toBe('left');
      expect(event.x).toBe(10);
      expect(event.y).toBe(20);
      resolve();
    });
  });

  // Act
  mouse.enable();
  stream.emit('data', Buffer.from(pressEvent));

  await eventPromise;

  // Cleanup
  mouse.destroy();
});

test('Mouse should be destroyed', () => {
  // Arrange
  const mouse = new Mouse(makeFakeTTYStream());
  mouse.enable();

  // Act
  mouse.destroy();

  // Assert
  expect(mouse.isEnabled()).toBe(false);
});

test('Mouse eventsOf should yield mouse events', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const iterator = mouse.eventsOf('press');

  try {
    mouse.enable();

    // Act
    const eventPromise = iterator.next();
    stream.emit('data', Buffer.from(pressEvent));
    const { value } = await eventPromise;

    // Assert
    expect(value.action).toBe('press');
    expect(value.button).toBe('left');
    expect(value.x).toBe(10);
    expect(value.y).toBe(20);
  } finally {
    // Cleanup
    await iterator.return(undefined);
    mouse.destroy();
  }
});

test('Mouse stream should yield mouse events', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const iterator = mouse.stream();

  try {
    mouse.enable();

    // Act
    const eventPromise = iterator.next();
    stream.emit('data', Buffer.from(pressEvent));
    const { value } = await eventPromise;

    // Assert
    expect(value.type).toBe('press');
    expect(value.event.action).toBe('press');
    expect(value.event.button).toBe('left');
    expect(value.event.x).toBe(10);
    expect(value.event.y).toBe(20);
  } finally {
    // Cleanup
    await iterator.return(undefined);
    mouse.destroy();
  }
});

test('Mouse handleEvent should emit error when event emission fails', (done) => {
  // Create a mock emitter that throws when emitting 'press' events
  const stream = makeFakeTTYStream();
  const mockEmitter = new EventEmitter();

  // Spy on the emit method to intercept calls
  const originalEmit = mockEmitter.emit.bind(mockEmitter);
  let emitCallCount = 0;

  // Replace emit with a version that throws an error on the second call
  // First call will be for the 'press' event, second will be for 'error'
  mockEmitter.emit = (event: string, ...args: unknown[]): boolean => {
    emitCallCount++;
    if (event === 'press' && emitCallCount === 1) {
      // On the first call (the press event), throw an error to trigger the catch block
      throw new Error('Handler error');
    }
    return originalEmit(event, ...args);
  };

  const mouse = new Mouse(stream, process.stdout, mockEmitter);

  // Listen for the error event that should be emitted from the catch block
  mockEmitter.on('error', (err) => {
    expect(err).toBeDefined();
    expect((err as Error).message).toBe('Handler error');
    mouse.destroy();
    done();
  });

  mouse.enable();

  // Act: Emit a valid mouse press event that will trigger the error in the handler
  // This will cause the handler to throw, which is caught and emitted as an 'error' event
  stream.emit('data', Buffer.from('\x1b[<0;10;20M'));
});

test('Mouse enable should throw error when inputStream is not TTY', () => {
  // Arrange: Create a stream that is not a TTY
  const nonTTYStream = new EventEmitter() as ReadableStreamWithEncoding;
  nonTTYStream.isTTY = false; // Explicitly set isTTY to false

  const mouse = new Mouse(nonTTYStream);

  // Act & Assert: enable should throw an error
  expect(() => {
    mouse.enable();
  }).toThrow('Mouse events require a TTY input stream');

  // Also verify that mouse is not enabled after the error
  expect(mouse.isEnabled()).toBe(false);

  // Cleanup (in case enable didn't fully fail)
  mouse.destroy();
});

test('Mouse enable should handle errors during setup from outputStream.write', () => {
  // Arrange: Create a stream that will fail during outputStream.write
  const stream = makeFakeTTYStream();
  const mockOutputStream = {
    write: (_chunk: unknown, _encoding?: BufferEncoding, _cb?: (error?: Error | null) => void): boolean => {
      throw new Error('Write failed');
    },
    cork: () => {},
    uncork: () => {},
  } as NodeJS.WriteStream;

  const mouse = new Mouse(stream, mockOutputStream);

  // Act & Assert: enable should throw an error when setup fails
  expect(() => {
    mouse.enable();
  }).toThrow('Failed to enable mouse: Write failed');

  // Also verify that mouse is not enabled after the error
  expect(mouse.isEnabled()).toBe(false);

  // Cleanup (in case enable didn't fully fail)
  mouse.destroy();
});

test('Mouse enable should handle errors during setup from setRawMode', () => {
  // Arrange: Create a stream that will fail during setRawMode
  const stream = makeFakeTTYStream();
  stream.setRawMode = (_mode: boolean): never => {
    throw new Error('setRawMode failed');
  };

  const mouse = new Mouse(stream);

  // Act & Assert: enable should throw an error when setRawMode fails
  expect(() => {
    mouse.enable();
  }).toThrow('Failed to enable mouse: setRawMode failed');

  // Also verify that mouse is not enabled after the error
  expect(mouse.isEnabled()).toBe(false);

  // Cleanup (in case enable didn't fully fail)
  mouse.destroy();
});

test('Mouse.disable() should throw MouseError when an error occurs', () => {
  // Arrange: Create a stream where outputStream.write will fail
  const stream = makeFakeTTYStream();
  const mockOutputStream = {
    write: (data: string) => {
      // Only throw error during disable (when turning mouse features OFF)
      if (data.includes('1006') && data.includes('l')) {
        // SGR disable code
        throw new Error('Write failed during disable');
      }
      return true;
    },
  } as NodeJS.WriteStream;

  const mouse = new Mouse(stream, mockOutputStream);

  mouse.enable();

  // Act & Assert: This should trigger the error in the disable method
  expect(() => {
    mouse.disable();
  }).toThrow('Failed to disable mouse: Write failed during disable');
});

test('Mouse eventsOf should use queue when multiple events arrive', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const iterator = mouse.eventsOf('press', { maxQueue: 5 }); // Use small max queue for testing

  mouse.enable();

  // Start the async generator by calling next() first
  const firstEventPromise = iterator.next();

  // Emit the first event to resolve the first promise
  stream.emit('data', Buffer.from('\x1b[<0;10;20M'));

  const { value: firstEvent } = await firstEventPromise;
  expect(firstEvent.action).toBe('press');
  expect(firstEvent.x).toBe(10);
  expect(firstEvent.y).toBe(20);

  // Now emit multiple events to build up the queue while the generator awaits
  stream.emit('data', Buffer.from('\x1b[<1;11;21M')); // Should go to queue
  stream.emit('data', Buffer.from('\x1b[<2;12;22M')); // Should also go to queue

  // Now get the second event (should come from the queue)
  const { value: secondEvent } = await iterator.next();
  expect(secondEvent.action).toBe('press');
  expect(secondEvent.x).toBe(11);
  expect(secondEvent.y).toBe(21);

  // Get the third event (should come from the queue as well)
  const { value: thirdEvent } = await iterator.next();
  expect(thirdEvent.action).toBe('press');
  expect(thirdEvent.x).toBe(12);
  expect(thirdEvent.y).toBe(22);

  // Cleanup
  await iterator.return(undefined);
  mouse.destroy();
});

test('Mouse eventsOf should use latestOnly option', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const iterator = mouse.eventsOf('press', { latestOnly: true }); // Use latestOnly option

  mouse.enable();

  // Start the async generator by calling next() first
  const firstEventPromise = iterator.next();

  // Emit the first event to resolve the first promise
  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press event

  const { value: firstEvent } = await firstEventPromise;
  expect(firstEvent.action).toBe('press');
  expect(firstEvent.x).toBe(10);
  expect(firstEvent.y).toBe(20);

  // Now emit multiple events rapidly - with latestOnly, only the latest should be kept
  stream.emit('data', Buffer.from('\x1b[<0;11;21M')); // press event
  stream.emit('data', Buffer.from('\x1b[<0;12;22M')); // press event - this should be the "latest"

  // Now get the second event (should be the latest one)
  const { value: latestEvent } = await iterator.next();
  expect(latestEvent.x).toBe(12); // Should be from the last event
  expect(latestEvent.y).toBe(22);
  expect(latestEvent.action).toBe('press'); // Should be a press event

  // Cleanup
  await iterator.return(undefined);
  mouse.destroy();
});

test('Mouse eventsOf should handle queue overflow', async () => {
  // Arrange - Use a small queue size to test overflow behavior
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const iterator = mouse.eventsOf('press', { maxQueue: 2 }); // Small max queue

  mouse.enable();

  // Emit 3 events to exceed the max queue size of 2
  // The first event will be handled by the promise, the next 2 will go to queue,
  // and when we emit the 3rd, it should cause the queue to shift (first item removed)
  const firstEventPromise = iterator.next();
  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // First event - handled by promise

  const { value: firstEvent } = await firstEventPromise;
  expect(firstEvent.x).toBe(10);

  // Now emit 3 more events to fill and overflow the queue (max size = 2)
  stream.emit('data', Buffer.from('\x1b[<0;11;21M')); // Goes to queue (pos 0)
  stream.emit('data', Buffer.from('\x1b[<0;12;22M')); // Goes to queue (pos 1) - queue is now full
  stream.emit('data', Buffer.from('\x1b[<0;13;23M')); // Should cause queue.shift() - oldest item removed, this one added

  // Now get second event - should be the second one we added (11,21), since first was consumed by the promise
  const { value: secondEvent } = await iterator.next();
  expect(secondEvent.x).toBe(12); // Should be the last item that was added when queue was full
  expect(secondEvent.y).toBe(22);

  // Get third event - should be the third one we added
  const { value: thirdEvent } = await iterator.next();
  expect(thirdEvent.x).toBe(13); // Should be the one that caused the shift
  expect(thirdEvent.y).toBe(23);

  // Cleanup
  await iterator.return(undefined);
  mouse.destroy();
});

test('Mouse stream should use latestOnly option', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const iterator = mouse.stream({ latestOnly: true }); // Use latestOnly option

  mouse.enable();

  // Start the async generator by calling next() first
  const firstEventPromise = iterator.next();

  // Emit the first event to resolve the first promise
  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press event

  const { value: firstEvent } = await firstEventPromise;
  expect(firstEvent.type).toBe('press');
  expect(firstEvent.event.x).toBe(10);
  expect(firstEvent.event.y).toBe(20);

  // Now emit multiple press events rapidly - with latestOnly, only the latest should be kept
  stream.emit('data', Buffer.from('\x1b[<0;11;21M')); // press event
  stream.emit('data', Buffer.from('\x1b[<0;12;22M')); // press event - this should be the "latest"

  // Now get the second event (should be the latest one)
  const { value: latestEvent } = await iterator.next();
  expect(latestEvent.event.x).toBe(12); // Should be from the last event
  expect(latestEvent.event.y).toBe(22);
  expect(latestEvent.type).toBe('press'); // Should be a press event

  // Cleanup
  await iterator.return(undefined);
  mouse.destroy();
});

test('Mouse.disable() should throw MouseError when an error occurs', () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mockOutputStream = {
    write: (data: string): boolean => {
      if (data.includes('1000l')) {
        // Check for a disable code
        throw new Error('Write failed');
      }
      return true;
    },
  } as NodeJS.WriteStream;
  const mouse = new Mouse(stream, mockOutputStream);
  mouse.enable();

  // Act & Assert
  expect(() => {
    mouse.disable();
  }).toThrow('Failed to disable mouse: Write failed');
});

test('Mouse.eventsOf() should handle errors', async () => {
  // Arrange
  const emitter = new EventEmitter();
  const mouse = new Mouse(makeFakeTTYStream(), process.stdout, emitter);
  const iterator = mouse.eventsOf('press');
  const error = new Error('Test error');

  // Act
  const promise = iterator.next();
  emitter.emit('error', error);

  // Assert
  await expect(promise).rejects.toThrow('Error in mouse event stream: Test error');

  // Cleanup
  await iterator.return(undefined);
  mouse.destroy();
});

test('Mouse should emit click event', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const releaseEvent = '\x1b[<0;10;20m';

  const eventPromise = new Promise<void>((resolve) => {
    mouse.on('click', (event) => {
      // Assert
      expect(event.action).toBe('click');
      expect(event.button).toBe('left');
      expect(event.x).toBe(10);
      expect(event.y).toBe(20);
      resolve();
    });
  });

  // Act
  mouse.enable();
  stream.emit('data', Buffer.from(pressEvent));
  stream.emit('data', Buffer.from(releaseEvent));

  await eventPromise;

  // Cleanup
  mouse.destroy();
});

test('Mouse should not emit click event if distance is too large', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const releaseEvent = '\x1b[<0;15;25m';

  const clickSpy = mock(() => {});
  mouse.on('click', clickSpy);

  // Act
  mouse.enable();
  stream.emit('data', Buffer.from(pressEvent));
  stream.emit('data', Buffer.from(releaseEvent));

  // Assert
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy).not.toHaveBeenCalled();

  // Cleanup
  mouse.destroy();
});

test('Mouse.stream() should handle errors', async () => {
  // Arrange
  const emitter = new EventEmitter();
  const mouse = new Mouse(makeFakeTTYStream(), process.stdout, emitter);
  const iterator = mouse.stream();
  const error = new Error('Test error');

  // Act
  const promise = iterator.next();
  emitter.emit('error', error);

  // Assert
  await expect(promise).rejects.toThrow('Error in mouse event stream: Test error');

  // Cleanup
  await iterator.return(undefined);
  mouse.destroy();
});

test('Mouse.eventsOf() should be cancellable with AbortSignal', async () => {
  // Arrange
  const mouse = new Mouse(makeFakeTTYStream());
  const controller = new AbortController();
  const iterator = mouse.eventsOf('press', { signal: controller.signal });

  try {
    mouse.enable();

    // Act
    const promise = iterator.next();
    controller.abort();

    // Assert
    await expect(promise).rejects.toThrow('The operation was aborted.');
  } finally {
    // Cleanup
    mouse.destroy();
  }
});

test('Mouse.stream() should handle high event volume without significant delay', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const iterator = mouse.stream();
  const eventCount = 10_000;
  const timeThreshold = 1000; // Increased to 1s, as the test is now more realistic

  try {
    mouse.enable();

    // Act
    const startTime = performance.now();

    // Consumer promise
    const consumePromise = (async (): Promise<void> => {
      let consumedCount = 0;
      for await (const _ of iterator) {
        consumedCount++;
        if (consumedCount === eventCount) {
          break;
        }
      }
    })();

    // Asynchronous emitter promise
    const emitPromise = (async (): Promise<void> => {
      for (let i = 0; i < eventCount; i++) {
        stream.emit('data', Buffer.from(`\x1b[<0;${i % 200};${i % 100}M`));
        // Yield to the event loop every 100 events to allow the consumer to process
        if (i % 100 === 0) {
          await Bun.sleep(0);
        }
      }
    })();

    await Promise.all([consumePromise, emitPromise]);

    const endTime = performance.now();
    const duration = endTime - startTime;

    // Assert
    console.log(`Processed ${eventCount} events in ${duration.toFixed(2)}ms`);
    expect(duration).toBeLessThan(timeThreshold);
  } finally {
    // Cleanup
    await iterator.return(undefined);
    mouse.destroy();
  }
}, 15000);

test('Mouse.stream() should be cancellable with AbortSignal', async () => {
  // Arrange
  const mouse = new Mouse(makeFakeTTYStream());
  const controller = new AbortController();
  const iterator = mouse.stream({ signal: controller.signal });

  try {
    mouse.enable();

    // Act
    const promise = iterator.next();
    controller.abort();

    // Assert
    await expect(promise).rejects.toThrow('The operation was aborted.');
  } finally {
    // Cleanup
    mouse.destroy();
  }
});
