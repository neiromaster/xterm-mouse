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

test('Mouse default threshold should emit click when press and release at same position', async () => {
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

test('Mouse default threshold should emit click when distance is exactly 1 cell', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const releaseEvent = '\x1b[<0;11;21m'; // xDiff=1, yDiff=1 (at threshold boundary)

  const eventPromise = new Promise<void>((resolve) => {
    mouse.on('click', (event) => {
      // Assert
      expect(event.action).toBe('click');
      expect(event.button).toBe('left');
      expect(event.x).toBe(11);
      expect(event.y).toBe(21);
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

test('Mouse default threshold should not emit click when distance exceeds 1 cell', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const releaseEvent = '\x1b[<0;12;22m'; // xDiff=2, yDiff=2 (beyond threshold)

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

test('Mouse default threshold should not emit click when only X distance exceeds 1', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const releaseEvent = '\x1b[<0;12;20m'; // xDiff=2, yDiff=0 (X exceeds threshold)

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

test('Mouse default threshold should not emit click when only Y distance exceeds 1', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const releaseEvent = '\x1b[<0;10;22m'; // xDiff=0, yDiff=2 (Y exceeds threshold)

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

test('Mouse default threshold should maintain backward compatibility with hardcoded behavior', async () => {
  // Arrange - This test verifies that the default threshold of 1
  // maintains the same behavior as the previous hardcoded implementation
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);

  // Test case 1: Same position (should click)
  const click1Promise = new Promise<void>((resolve) => {
    mouse.on('click', (event) => {
      expect(event.x).toBe(10);
      expect(event.y).toBe(20);
      resolve();
    });
  });

  mouse.enable();
  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press at (10,20)
  stream.emit('data', Buffer.from('\x1b[<0;10;20m')); // release at (10,20)
  await click1Promise;

  // Test case 2: Distance of 1 in both directions (should click)
  const click2Promise = new Promise<void>((resolve) => {
    const handler = (event: unknown) => {
      mouse.off('click', handler);
      expect(event).toBeDefined();
      resolve();
    };
    mouse.on('click', handler);
  });

  stream.emit('data', Buffer.from('\x1b[<0;30;40M')); // press at (30,40)
  stream.emit('data', Buffer.from('\x1b[<0;31;41m')); // release at (31,41) - distance of 1
  await click2Promise;

  // Test case 3: Distance > 1 (should not click)
  const clickSpy = mock(() => {});
  mouse.on('click', clickSpy);

  stream.emit('data', Buffer.from('\x1b[<0;50;60M')); // press at (50,60)
  stream.emit('data', Buffer.from('\x1b[<0;53;63m')); // release at (53,63) - distance of 3

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy).not.toHaveBeenCalled();

  // Cleanup
  mouse.destroy();
});

test('Mouse with threshold 0 should only emit click when press and release at exact same position', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream, undefined, undefined, { clickDistanceThreshold: 0 });

  // Act & Assert - Test exact position (should click)
  const click1Promise = new Promise<void>((resolve) => {
    mouse.on('click', (event) => {
      expect(event.x).toBe(10);
      expect(event.y).toBe(20);
      resolve();
    });
  });

  mouse.enable();
  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press at (10,20)
  stream.emit('data', Buffer.from('\x1b[<0;10;20m')); // release at (10,20) - exact same position
  await click1Promise;

  // Act & Assert - Test position with distance of 1 (should NOT click)
  const clickSpy = mock(() => {});
  mouse.on('click', clickSpy);

  stream.emit('data', Buffer.from('\x1b[<0;30;40M')); // press at (30,40)
  stream.emit('data', Buffer.from('\x1b[<0;31;41m')); // release at (31,41) - xDiff=1, yDiff=1

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy).not.toHaveBeenCalled();

  // Cleanup
  mouse.destroy();
});

test('Mouse with threshold 2 should emit click when distance is within 2 cells', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream, undefined, undefined, { clickDistanceThreshold: 2 });

  // Act & Assert - Test distance of 2 (should click)
  const click1Promise = new Promise<void>((resolve) => {
    mouse.on('click', (event) => {
      expect(event.x).toBe(12);
      expect(event.y).toBe(22);
      resolve();
    });
  });

  mouse.enable();
  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press at (10,20)
  stream.emit('data', Buffer.from('\x1b[<0;12;22m')); // release at (12,22) - xDiff=2, yDiff=2
  await click1Promise;

  // Act & Assert - Test distance of 3 (should NOT click)
  const clickSpy = mock(() => {});
  mouse.on('click', clickSpy);

  stream.emit('data', Buffer.from('\x1b[<0;50;60M')); // press at (50,60)
  stream.emit('data', Buffer.from('\x1b[<0;53;63m')); // release at (53,63) - xDiff=3, yDiff=3

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy).not.toHaveBeenCalled();

  // Cleanup
  mouse.destroy();
});

test('Mouse with threshold 5 should emit click when distance is within 5 cells', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream, undefined, undefined, { clickDistanceThreshold: 5 });

  // Act & Assert - Test distance of 5 (should click)
  const click1Promise = new Promise<void>((resolve) => {
    mouse.on('click', (event) => {
      expect(event.x).toBe(15);
      expect(event.y).toBe(25);
      resolve();
    });
  });

  mouse.enable();
  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press at (10,20)
  stream.emit('data', Buffer.from('\x1b[<0;15;25m')); // release at (15,25) - xDiff=5, yDiff=5
  await click1Promise;

  // Act & Assert - Test distance of 6 (should NOT click)
  const clickSpy = mock(() => {});
  mouse.on('click', clickSpy);

  stream.emit('data', Buffer.from('\x1b[<0;50;60M')); // press at (50,60)
  stream.emit('data', Buffer.from('\x1b[<0;56;66m')); // release at (56,66) - xDiff=6, yDiff=6

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy).not.toHaveBeenCalled();

  // Cleanup
  mouse.destroy();
});

test('Mouse with threshold 10 should emit click when distance is within 10 cells', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream, undefined, undefined, { clickDistanceThreshold: 10 });

  // Act & Assert - Test distance of 10 (should click)
  const click1Promise = new Promise<void>((resolve) => {
    mouse.on('click', (event) => {
      expect(event.x).toBe(20);
      expect(event.y).toBe(30);
      resolve();
    });
  });

  mouse.enable();
  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press at (10,20)
  stream.emit('data', Buffer.from('\x1b[<0;20;30m')); // release at (20,30) - xDiff=10, yDiff=10
  await click1Promise;

  // Act & Assert - Test distance of 11 (should NOT click)
  const clickSpy = mock(() => {});
  mouse.on('click', clickSpy);

  stream.emit('data', Buffer.from('\x1b[<0;50;60M')); // press at (50,60)
  stream.emit('data', Buffer.from('\x1b[<0;61;71m')); // release at (61,71) - xDiff=11, yDiff=11

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy).not.toHaveBeenCalled();

  // Cleanup
  mouse.destroy();
});

test('Mouse with threshold 0 should require exact same position - all edge cases', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream, undefined, undefined, { clickDistanceThreshold: 0 });

  mouse.enable();

  // Act & Assert - Test 1: Exact same position (should click)
  const click1Promise = new Promise<void>((resolve) => {
    const handler = (event: unknown) => {
      mouse.off('click', handler);
      expect(event).toBeDefined();
      resolve();
    };
    mouse.on('click', handler);
  });

  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press at (10,20)
  stream.emit('data', Buffer.from('\x1b[<0;10;20m')); // release at (10,20) - exact same position
  await click1Promise;

  // Act & Assert - Test 2: X differs by 1, Y is same (should NOT click)
  const clickSpy1 = mock(() => {});
  mouse.on('click', clickSpy1);

  stream.emit('data', Buffer.from('\x1b[<0;30;40M')); // press at (30,40)
  stream.emit('data', Buffer.from('\x1b[<0;31;40m')); // release at (31,40) - xDiff=1, yDiff=0

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy1).not.toHaveBeenCalled();

  // Act & Assert - Test 3: Y differs by 1, X is same (should NOT click)
  const clickSpy2 = mock(() => {});
  mouse.on('click', clickSpy2);

  stream.emit('data', Buffer.from('\x1b[<0;50;60M')); // press at (50,60)
  stream.emit('data', Buffer.from('\x1b[<0;50;61m')); // release at (50,61) - xDiff=0, yDiff=1

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy2).not.toHaveBeenCalled();

  // Act & Assert - Test 4: Both X and Y differ by 1 (should NOT click)
  const clickSpy3 = mock(() => {});
  mouse.on('click', clickSpy3);

  stream.emit('data', Buffer.from('\x1b[<0;70;80M')); // press at (70,80)
  stream.emit('data', Buffer.from('\x1b[<0;71;81m')); // release at (71,81) - xDiff=1, yDiff=1

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy3).not.toHaveBeenCalled();

  // Act & Assert - Test 5: X differs by more, Y is same (should NOT click)
  const clickSpy4 = mock(() => {});
  mouse.on('click', clickSpy4);

  stream.emit('data', Buffer.from('\x1b[<0;90;100M')); // press at (90,100)
  stream.emit('data', Buffer.from('\x1b[<0;95;100m')); // release at (95,100) - xDiff=5, yDiff=0

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy4).not.toHaveBeenCalled();

  // Act & Assert - Test 6: Y differs by more, X is same (should NOT click)
  const clickSpy5 = mock(() => {});
  mouse.on('click', clickSpy5);

  stream.emit('data', Buffer.from('\x1b[<0;110;120M')); // press at (110,120)
  stream.emit('data', Buffer.from('\x1b[<0;110;125m')); // release at (110,125) - xDiff=0, yDiff=5

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy5).not.toHaveBeenCalled();

  // Act & Assert - Test 7: Verify exact position works again at different coordinates
  const click2Promise = new Promise<void>((resolve) => {
    const handler = (event: unknown) => {
      mouse.off('click', handler);
      expect(event).toBeDefined();
      resolve();
    };
    mouse.on('click', handler);
  });

  stream.emit('data', Buffer.from('\x1b[<0;200;300M')); // press at (200,300)
  stream.emit('data', Buffer.from('\x1b[<0;200;300m')); // release at (200,300) - exact same position
  await click2Promise;

  // Cleanup
  mouse.destroy();
});

test('Mouse with threshold 50 should emit click when distance is within 50 cells', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream, undefined, undefined, { clickDistanceThreshold: 50 });

  // Act & Assert - Test distance of 50 (should click)
  const click1Promise = new Promise<void>((resolve) => {
    mouse.on('click', (event) => {
      expect(event.x).toBe(60);
      expect(event.y).toBe(70);
      resolve();
    });
  });

  mouse.enable();
  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press at (10,20)
  stream.emit('data', Buffer.from('\x1b[<0;60;70m')); // release at (60,70) - xDiff=50, yDiff=50
  await click1Promise;

  // Act & Assert - Test distance of 51 (should NOT click)
  const clickSpy = mock(() => {});
  mouse.on('click', clickSpy);

  stream.emit('data', Buffer.from('\x1b[<0;100;200M')); // press at (100,200)
  stream.emit('data', Buffer.from('\x1b[<0;151;251m')); // release at (151,251) - xDiff=51, yDiff=51

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy).not.toHaveBeenCalled();

  // Cleanup
  mouse.destroy();
});

test('Mouse with threshold 100 should emit click when distance is within 100 cells', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream, undefined, undefined, { clickDistanceThreshold: 100 });

  // Act & Assert - Test distance of 100 (should click)
  const click1Promise = new Promise<void>((resolve) => {
    mouse.on('click', (event) => {
      expect(event.x).toBe(110);
      expect(event.y).toBe(120);
      resolve();
    });
  });

  mouse.enable();
  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press at (10,20)
  stream.emit('data', Buffer.from('\x1b[<0;110;120m')); // release at (110,120) - xDiff=100, yDiff=100
  await click1Promise;

  // Act & Assert - Test distance of 101 (should NOT click)
  const clickSpy = mock(() => {});
  mouse.on('click', clickSpy);

  stream.emit('data', Buffer.from('\x1b[<0;200;300M')); // press at (200,300)
  stream.emit('data', Buffer.from('\x1b[<0;301;401m')); // release at (301,401) - xDiff=101, yDiff=101

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy).not.toHaveBeenCalled();

  // Cleanup
  mouse.destroy();
});

test('Mouse with threshold 500 should emit click when distance is within 500 cells', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream, undefined, undefined, { clickDistanceThreshold: 500 });

  // Act & Assert - Test distance of 500 (should click)
  const click1Promise = new Promise<void>((resolve) => {
    mouse.on('click', (event) => {
      expect(event.x).toBe(510);
      expect(event.y).toBe(520);
      resolve();
    });
  });

  mouse.enable();
  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press at (10,20)
  stream.emit('data', Buffer.from('\x1b[<0;510;520m')); // release at (510,520) - xDiff=500, yDiff=500
  await click1Promise;

  // Act & Assert - Test distance of 501 (should NOT click)
  const clickSpy = mock(() => {});
  mouse.on('click', clickSpy);

  stream.emit('data', Buffer.from('\x1b[<0;1000;2000M')); // press at (1000,2000)
  stream.emit('data', Buffer.from('\x1b[<0;1501;2501m')); // release at (1501,2501) - xDiff=501, yDiff=501

  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy).not.toHaveBeenCalled();

  // Cleanup
  mouse.destroy();
});
