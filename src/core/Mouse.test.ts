import { describe, expect, mock, test } from 'bun:test';
import { EventEmitter } from 'node:events';

import type { MouseEvent, ReadableStreamWithEncoding } from '../types';

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

test('Mouse.pause() should set paused state', () => {
  // Arrange
  const mouse = new Mouse(makeFakeTTYStream());

  // Act
  mouse.pause();

  // Assert
  expect(mouse.isPaused()).toBe(true);

  // Cleanup
  mouse.destroy();
});

test('Mouse.resume() should clear paused state', () => {
  // Arrange
  const mouse = new Mouse(makeFakeTTYStream());
  mouse.pause();

  // Act
  mouse.resume();

  // Assert
  expect(mouse.isPaused()).toBe(false);

  // Cleanup
  mouse.destroy();
});

test('Mouse.isPaused() should report correct state', () => {
  // Arrange
  const mouse = new Mouse(makeFakeTTYStream());

  // Assert initial state
  expect(mouse.isPaused()).toBe(false);

  // Act - pause
  mouse.pause();

  // Assert paused state
  expect(mouse.isPaused()).toBe(true);

  // Act - resume
  mouse.resume();

  // Assert resumed state
  expect(mouse.isPaused()).toBe(false);

  // Cleanup
  mouse.destroy();
});

test('Mouse.pause() should be idempotent', () => {
  // Arrange
  const mouse = new Mouse(makeFakeTTYStream());

  // Act - call pause twice
  mouse.pause();
  mouse.pause();

  // Assert - should still be paused
  expect(mouse.isPaused()).toBe(true);

  // Cleanup
  mouse.destroy();
});

test('Mouse.resume() should be idempotent', () => {
  // Arrange
  const mouse = new Mouse(makeFakeTTYStream());
  mouse.pause();

  // Act - call resume twice
  mouse.resume();
  mouse.resume();

  // Assert - should still be not paused
  expect(mouse.isPaused()).toBe(false);

  // Cleanup
  mouse.destroy();
});

test('Mouse.pause()/resume() should work without enable', () => {
  // Arrange
  const mouse = new Mouse(makeFakeTTYStream());

  // Act & Assert - pause/resume should work even when not enabled
  expect(mouse.isEnabled()).toBe(false);
  expect(mouse.isPaused()).toBe(false);

  mouse.pause();
  expect(mouse.isPaused()).toBe(true);
  expect(mouse.isEnabled()).toBe(false);

  mouse.resume();
  expect(mouse.isPaused()).toBe(false);
  expect(mouse.isEnabled()).toBe(false);

  // Cleanup
  mouse.destroy();
});

test('Mouse should not emit press events when paused', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const pressSpy = mock(() => {});

  mouse.on('press', pressSpy);
  mouse.enable();

  // Act - pause the mouse
  mouse.pause();

  // Emit a press event while paused
  stream.emit('data', Buffer.from(pressEvent));

  // Assert - no press event should be emitted
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(pressSpy).not.toHaveBeenCalled();

  // Act - resume the mouse
  mouse.resume();

  // Emit another press event after resume
  stream.emit('data', Buffer.from(pressEvent));

  // Assert - press event should now be emitted
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(pressSpy).toHaveBeenCalledTimes(1);
  expect(pressSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'press',
      button: 'left',
      x: 10,
      y: 20,
    }),
  );

  // Cleanup
  mouse.destroy();
});

test('Mouse should not emit release events when paused', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const releaseEvent = '\x1b[<0;10;20m';
  const releaseSpy = mock(() => {});

  mouse.on('release', releaseSpy);
  mouse.enable();

  // Act - pause the mouse
  mouse.pause();

  // Emit a release event while paused
  stream.emit('data', Buffer.from(releaseEvent));

  // Assert - no release event should be emitted
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(releaseSpy).not.toHaveBeenCalled();

  // Act - resume the mouse
  mouse.resume();

  // Emit another release event after resume
  stream.emit('data', Buffer.from(releaseEvent));

  // Assert - release event should now be emitted
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(releaseSpy).toHaveBeenCalledTimes(1);
  expect(releaseSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'release',
      button: 'left',
      x: 10,
      y: 20,
    }),
  );

  // Cleanup
  mouse.destroy();
});

test('Mouse should not emit drag events when paused', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const dragEvent = '\x1b[<32;15;25M'; // Button 32 = left button with motion bit
  const dragSpy = mock(() => {});

  mouse.on('drag', dragSpy);
  mouse.enable();

  // Act - pause the mouse
  mouse.pause();

  // Emit a drag event while paused
  stream.emit('data', Buffer.from(dragEvent));

  // Assert - no drag event should be emitted
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(dragSpy).not.toHaveBeenCalled();

  // Act - resume the mouse
  mouse.resume();

  // Emit another drag event after resume
  stream.emit('data', Buffer.from(dragEvent));

  // Assert - drag event should now be emitted
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(dragSpy).toHaveBeenCalledTimes(1);
  expect(dragSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'drag',
      button: 'left',
      x: 15,
      y: 25,
    }),
  );

  // Cleanup
  mouse.destroy();
});

test('Mouse should not emit wheel events when paused', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const wheelEvent = '\x1b[<64;10;20M'; // Button 64 = wheel up
  const wheelSpy = mock(() => {});

  mouse.on('wheel', wheelSpy);
  mouse.enable();

  // Act - pause the mouse
  mouse.pause();

  // Emit a wheel event while paused
  stream.emit('data', Buffer.from(wheelEvent));

  // Assert - no wheel event should be emitted
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(wheelSpy).not.toHaveBeenCalled();

  // Act - resume the mouse
  mouse.resume();

  // Emit another wheel event after resume
  stream.emit('data', Buffer.from(wheelEvent));

  // Assert - wheel event should now be emitted
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(wheelSpy).toHaveBeenCalledTimes(1);
  expect(wheelSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'wheel',
      button: 'wheel-up',
      x: 10,
      y: 20,
    }),
  );

  // Cleanup
  mouse.destroy();
});

test('Mouse should not emit move events when paused', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const moveEvent = '\x1b[<35;10;20M'; // Button 35 = button 3 with motion bit (move)
  const moveSpy = mock(() => {});

  mouse.on('move', moveSpy);
  mouse.enable();

  // Act - pause the mouse
  mouse.pause();

  // Emit a move event while paused
  stream.emit('data', Buffer.from(moveEvent));

  // Assert - no move event should be emitted
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(moveSpy).not.toHaveBeenCalled();

  // Act - resume the mouse
  mouse.resume();

  // Emit another move event after resume
  stream.emit('data', Buffer.from(moveEvent));

  // Assert - move event should now be emitted
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(moveSpy).toHaveBeenCalledTimes(1);
  expect(moveSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'move',
      button: 'none',
      x: 10,
      y: 20,
    }),
  );

  // Cleanup
  mouse.destroy();
});

test('Mouse should not emit click events when paused', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const releaseEvent = '\x1b[<0;10;20m';
  const clickSpy = mock(() => {});

  mouse.on('click', clickSpy);
  mouse.enable();

  // Act - pause the mouse
  mouse.pause();

  // Emit press and release events while paused
  stream.emit('data', Buffer.from(pressEvent));
  stream.emit('data', Buffer.from(releaseEvent));

  // Assert - no click event should be emitted
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy).not.toHaveBeenCalled();

  // Act - resume the mouse
  mouse.resume();

  // Emit press and release events after resume
  stream.emit('data', Buffer.from(pressEvent));
  stream.emit('data', Buffer.from(releaseEvent));

  // Assert - click event should now be emitted
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(clickSpy).toHaveBeenCalledTimes(1);
  expect(clickSpy).toHaveBeenCalledWith(
    expect.objectContaining({
      action: 'click',
      button: 'left',
      x: 10,
      y: 20,
    }),
  );

  // Cleanup
  mouse.destroy();
});

test('Mouse should block all event types when paused', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);

  const pressSpy = mock(() => {});
  const releaseSpy = mock(() => {});
  const dragSpy = mock(() => {});
  const wheelSpy = mock(() => {});
  const moveSpy = mock(() => {});

  mouse.on('press', pressSpy);
  mouse.on('release', releaseSpy);
  mouse.on('drag', dragSpy);
  mouse.on('wheel', wheelSpy);
  mouse.on('move', moveSpy);

  mouse.enable();

  // Act - pause the mouse
  mouse.pause();

  // Emit various events while paused
  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press
  stream.emit('data', Buffer.from('\x1b[<0;10;20m')); // release
  stream.emit('data', Buffer.from('\x1b[<32;15;25M')); // drag
  stream.emit('data', Buffer.from('\x1b[<64;10;20M')); // wheel
  stream.emit('data', Buffer.from('\x1b[<35;10;20M')); // move

  // Assert - no events should be emitted while paused
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(pressSpy).not.toHaveBeenCalled();
  expect(releaseSpy).not.toHaveBeenCalled();
  expect(dragSpy).not.toHaveBeenCalled();
  expect(wheelSpy).not.toHaveBeenCalled();
  expect(moveSpy).not.toHaveBeenCalled();

  // Act - resume the mouse
  mouse.resume();

  // Emit the same events after resume
  stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press
  stream.emit('data', Buffer.from('\x1b[<0;10;20m')); // release
  stream.emit('data', Buffer.from('\x1b[<32;15;25M')); // drag
  stream.emit('data', Buffer.from('\x1b[<64;10;20M')); // wheel
  stream.emit('data', Buffer.from('\x1b[<35;10;20M')); // move

  // Assert - all events should now be emitted
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(pressSpy).toHaveBeenCalledTimes(1);
  expect(releaseSpy).toHaveBeenCalledTimes(1);
  expect(dragSpy).toHaveBeenCalledTimes(1);
  expect(wheelSpy).toHaveBeenCalledTimes(1);
  expect(moveSpy).toHaveBeenCalledTimes(1);

  // Cleanup
  mouse.destroy();
});

test('Mouse.pause()/resume() should not make terminal mode changes', () => {
  // Arrange - Create stream with mocked methods to track terminal mode changes
  const stream = makeFakeTTYStream();
  const writeSpy = mock(() => true);
  const setRawModeSpy = mock(() => stream);

  const mockOutputStream = {
    write: writeSpy,
  } as unknown as NodeJS.WriteStream;

  stream.setRawMode = setRawModeSpy as never;

  const mouse = new Mouse(stream, mockOutputStream);

  // Act - call pause() without enabling
  mouse.pause();

  // Assert - verify paused state changed but no terminal mode changes occurred
  expect(mouse.isPaused()).toBe(true);
  expect(mouse.isEnabled()).toBe(false);
  expect(writeSpy).not.toHaveBeenCalled();
  expect(setRawModeSpy).not.toHaveBeenCalled();

  // Act - call resume() without enabling
  mouse.resume();

  // Assert - verify paused state changed but still no terminal mode changes
  expect(mouse.isPaused()).toBe(false);
  expect(mouse.isEnabled()).toBe(false);
  expect(writeSpy).not.toHaveBeenCalled();
  expect(setRawModeSpy).not.toHaveBeenCalled();

  // Cleanup
  mouse.destroy();
});

test('Mouse.pause()/resume() should not interfere with enable/disable', () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const writeSpy = mock(() => true);
  const setRawModeSpy = mock(() => stream);

  const mockOutputStream = {
    write: writeSpy,
  } as unknown as NodeJS.WriteStream;

  stream.setRawMode = setRawModeSpy as never;

  const mouse = new Mouse(stream, mockOutputStream);

  // Act - pause before enable
  mouse.pause();

  // Assert - should be paused but not enabled, no terminal writes
  expect(mouse.isPaused()).toBe(true);
  expect(mouse.isEnabled()).toBe(false);
  expect(writeSpy).not.toHaveBeenCalled();

  // Act - now enable (should enable terminal mode)
  mouse.enable();

  // Assert - should be enabled and paused, terminal writes should have occurred
  expect(mouse.isEnabled()).toBe(true);
  expect(mouse.isPaused()).toBe(true);
  expect(writeSpy).toHaveBeenCalled();
  expect(setRawModeSpy).toHaveBeenCalledWith(true);

  // Reset spies for next verification
  writeSpy.mockClear();
  setRawModeSpy.mockClear();

  // Act - resume (should not make terminal changes)
  mouse.resume();

  // Assert - should be enabled and not paused, no additional terminal writes
  expect(mouse.isEnabled()).toBe(true);
  expect(mouse.isPaused()).toBe(false);
  expect(writeSpy).not.toHaveBeenCalled();
  expect(setRawModeSpy).not.toHaveBeenCalled();

  // Cleanup
  mouse.disable();
  mouse.destroy();
});

test('Mouse.eventsOf() should not yield events when paused', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const iterator = mouse.eventsOf('press');

  try {
    mouse.enable();

    // Start the async generator
    const firstEventPromise = iterator.next();

    // Act - pause the mouse
    mouse.pause();

    // Emit a press event while paused
    stream.emit('data', Buffer.from(pressEvent));

    // Give some time for event processing
    await Bun.sleep(50);

    // Assert - the promise should still be pending (no event yielded)
    // We can verify this by checking if we can create a race that times out
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100));

    try {
      await Promise.race([firstEventPromise, timeoutPromise]);
      // If we get here, the event was yielded (which is wrong)
      expect(false).toBe(true); // This should not be reached
    } catch (err) {
      // We expect a timeout error, meaning no event was yielded
      expect((err as Error).message).toBe('Timeout');
    }

    // Act - resume the mouse
    mouse.resume();

    // Emit another press event after resume
    stream.emit('data', Buffer.from(pressEvent));

    // Assert - now the event should be yielded
    const { value } = await firstEventPromise;
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

test('Mouse.eventsOf() should queue and yield events after resume', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const iterator = mouse.eventsOf('press');

  try {
    mouse.enable();

    // Start the async generator by consuming the first event
    const firstEventPromise = iterator.next();
    stream.emit('data', Buffer.from('\x1b[<0;10;20M'));
    const { value: firstEvent } = await firstEventPromise;
    expect(firstEvent.x).toBe(10);

    // Act - pause the mouse
    mouse.pause();

    // Emit events while paused (these should be dropped, not queued)
    stream.emit('data', Buffer.from('\x1b[<0;11;21M'));
    stream.emit('data', Buffer.from('\x1b[<0;12;22M'));

    await Bun.sleep(50);

    // Act - resume the mouse
    mouse.resume();

    // Emit new events after resume (these should be yielded)
    stream.emit('data', Buffer.from('\x1b[<0;13;23M'));
    stream.emit('data', Buffer.from('\x1b[<0;14;24M'));

    // Assert - should get the events after resume, not the ones during pause
    const { value: secondEvent } = await iterator.next();
    expect(secondEvent.x).toBe(13); // First event after resume
    expect(secondEvent.y).toBe(23);

    const { value: thirdEvent } = await iterator.next();
    expect(thirdEvent.x).toBe(14); // Second event after resume
    expect(thirdEvent.y).toBe(24);
  } finally {
    // Cleanup
    await iterator.return(undefined);
    mouse.destroy();
  }
});

test('Mouse.stream() should not yield events when paused', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const iterator = mouse.stream();

  try {
    mouse.enable();

    // Start the async generator
    const firstEventPromise = iterator.next();

    // Act - pause the mouse
    mouse.pause();

    // Emit a press event while paused
    stream.emit('data', Buffer.from(pressEvent));

    // Give some time for event processing
    await Bun.sleep(50);

    // Assert - the promise should still be pending (no event yielded)
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100));

    try {
      await Promise.race([firstEventPromise, timeoutPromise]);
      // If we get here, the event was yielded (which is wrong)
      expect(false).toBe(true); // This should not be reached
    } catch (err) {
      // We expect a timeout error, meaning no event was yielded
      expect((err as Error).message).toBe('Timeout');
    }

    // Act - resume the mouse
    mouse.resume();

    // Emit another press event after resume
    stream.emit('data', Buffer.from(pressEvent));

    // Assert - now the event should be yielded
    const { value } = await firstEventPromise;
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

test('Mouse.stream() should not yield events of any type when paused', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const iterator = mouse.stream();

  try {
    mouse.enable();

    // Start the async generator
    const firstEventPromise = iterator.next();

    // Act - pause the mouse
    mouse.pause();

    // Emit various events while paused
    stream.emit('data', Buffer.from('\x1b[<0;10;20M')); // press
    stream.emit('data', Buffer.from('\x1b[<0;10;20m')); // release
    stream.emit('data', Buffer.from('\x1b[<32;15;25M')); // drag
    stream.emit('data', Buffer.from('\x1b[<64;10;20M')); // wheel
    stream.emit('data', Buffer.from('\x1b[<35;10;20M')); // move

    // Give some time for event processing
    await Bun.sleep(50);

    // Assert - the promise should still be pending (no events yielded)
    const timeoutPromise = new Promise((_, reject) => setTimeout(() => reject(new Error('Timeout')), 100));

    try {
      await Promise.race([firstEventPromise, timeoutPromise]);
      // If we get here, an event was yielded (which is wrong)
      expect(false).toBe(true); // This should not be reached
    } catch (err) {
      // We expect a timeout error, meaning no event was yielded
      expect((err as Error).message).toBe('Timeout');
    }

    // Act - resume the mouse
    mouse.resume();

    // Emit events after resume
    stream.emit('data', Buffer.from('\x1b[<0;11;21M')); // press

    // Assert - now events should be yielded
    const { value } = await firstEventPromise;
    expect(value.type).toBe('press');
    expect(value.event.x).toBe(11);
    expect(value.event.y).toBe(21);
  } finally {
    // Cleanup
    await iterator.return(undefined);
    mouse.destroy();
  }
});

test('Mouse.eventsOf() with latestOnly should not update when paused', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const iterator = mouse.eventsOf('press', { latestOnly: true });

  try {
    mouse.enable();

    // Start the async generator by consuming the first event
    const firstEventPromise = iterator.next();
    stream.emit('data', Buffer.from('\x1b[<0;10;20M'));
    const { value: firstEvent } = await firstEventPromise;
    expect(firstEvent.x).toBe(10);

    // Act - pause the mouse
    mouse.pause();

    // Emit multiple events while paused (none should be captured)
    stream.emit('data', Buffer.from('\x1b[<0;11;21M'));
    stream.emit('data', Buffer.from('\x1b[<0;12;22M'));
    stream.emit('data', Buffer.from('\x1b[<0;13;23M'));

    await Bun.sleep(50);

    // Act - resume the mouse
    mouse.resume();

    // Emit new events after resume
    stream.emit('data', Buffer.from('\x1b[<0;14;24M'));
    stream.emit('data', Buffer.from('\x1b[<0;15;25M'));

    // Assert - should get the latest event after resume, not any from pause
    const { value: latestEvent } = await iterator.next();
    expect(latestEvent.x).toBe(15); // Latest event after resume
    expect(latestEvent.y).toBe(25);
  } finally {
    // Cleanup
    await iterator.return(undefined);
    mouse.destroy();
  }
});

test('Mouse.pause() then disable() should preserve paused state', () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);

  // Act - enable, then pause, then disable
  mouse.enable();
  mouse.pause();
  mouse.disable();

  // Assert - paused state should be preserved even after disable
  expect(mouse.isPaused()).toBe(true);
  expect(mouse.isEnabled()).toBe(false);

  // Act - re-enable
  mouse.enable();

  // Assert - should still be paused after re-enable
  expect(mouse.isEnabled()).toBe(true);
  expect(mouse.isPaused()).toBe(true);

  // Cleanup
  mouse.destroy();
});

test('Mouse.disable() then pause() should set paused state independently', () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);

  // Act - enable, then disable, then pause
  mouse.enable();
  mouse.disable();
  mouse.pause();

  // Assert - both states should be independent
  expect(mouse.isEnabled()).toBe(false);
  expect(mouse.isPaused()).toBe(true);

  // Act - resume
  mouse.resume();

  // Assert - paused state cleared, but still disabled
  expect(mouse.isPaused()).toBe(false);
  expect(mouse.isEnabled()).toBe(false);

  // Cleanup
  mouse.destroy();
});

test('Mouse.resume() while disabled should not make terminal changes', () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const writeSpy = mock(() => true);
  const setRawModeSpy = mock(() => stream);

  const mockOutputStream = {
    write: writeSpy,
  } as unknown as NodeJS.WriteStream;

  stream.setRawMode = setRawModeSpy as never;

  const mouse = new Mouse(stream, mockOutputStream);

  // Act - enable, pause, disable, then resume while disabled
  mouse.enable();
  mouse.pause();
  mouse.disable();

  // Reset spies to clear previous calls
  writeSpy.mockClear();
  setRawModeSpy.mockClear();

  mouse.resume();

  // Assert - resume should not make any terminal writes
  expect(mouse.isPaused()).toBe(false);
  expect(mouse.isEnabled()).toBe(false);
  expect(writeSpy).not.toHaveBeenCalled();
  expect(setRawModeSpy).not.toHaveBeenCalled();

  // Cleanup
  mouse.destroy();
});

test('Mouse.enable() while paused should preserve paused state', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const pressSpy = mock(() => {});

  mouse.on('press', pressSpy);

  // Act - pause before enable
  mouse.pause();

  // Enable while paused
  mouse.enable();

  // Assert - should be enabled but still paused
  expect(mouse.isEnabled()).toBe(true);
  expect(mouse.isPaused()).toBe(true);

  // Emit an event while paused
  stream.emit('data', Buffer.from(pressEvent));

  // Assert - no event should be emitted while paused
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(pressSpy).not.toHaveBeenCalled();

  // Act - resume
  mouse.resume();

  // Emit another event after resume
  stream.emit('data', Buffer.from(pressEvent));

  // Assert - event should now be emitted
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(pressSpy).toHaveBeenCalledTimes(1);

  // Cleanup
  mouse.destroy();
});

test('Mouse should handle full cycle: pause → disable → enable → resume', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const pressSpy = mock(() => {});

  mouse.on('press', pressSpy);

  // Act - full cycle: enable → pause → disable → enable → resume
  mouse.enable();
  expect(mouse.isEnabled()).toBe(true);
  expect(mouse.isPaused()).toBe(false);

  mouse.pause();
  expect(mouse.isEnabled()).toBe(true);
  expect(mouse.isPaused()).toBe(true);

  mouse.disable();
  expect(mouse.isEnabled()).toBe(false);
  expect(mouse.isPaused()).toBe(true); // Paused state preserved

  mouse.enable();
  expect(mouse.isEnabled()).toBe(true);
  expect(mouse.isPaused()).toBe(true); // Still paused

  // Emit event while paused - should be blocked
  stream.emit('data', Buffer.from(pressEvent));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(pressSpy).not.toHaveBeenCalled();

  mouse.resume();
  expect(mouse.isEnabled()).toBe(true);
  expect(mouse.isPaused()).toBe(false);

  // Emit event after resume - should be emitted
  stream.emit('data', Buffer.from(pressEvent));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(pressSpy).toHaveBeenCalledTimes(1);

  // Cleanup
  mouse.destroy();
});

test('Mouse should handle reverse cycle: disable → pause → enable → resume', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const pressSpy = mock(() => {});

  mouse.on('press', pressSpy);

  // Act - reverse cycle: enable → disable → pause → enable → resume
  mouse.enable();
  expect(mouse.isEnabled()).toBe(true);
  expect(mouse.isPaused()).toBe(false);

  mouse.disable();
  expect(mouse.isEnabled()).toBe(false);
  expect(mouse.isPaused()).toBe(false);

  mouse.pause();
  expect(mouse.isEnabled()).toBe(false);
  expect(mouse.isPaused()).toBe(true);

  mouse.enable();
  expect(mouse.isEnabled()).toBe(true);
  expect(mouse.isPaused()).toBe(true); // Still paused

  // Emit event while paused - should be blocked
  stream.emit('data', Buffer.from(pressEvent));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(pressSpy).not.toHaveBeenCalled();

  mouse.resume();
  expect(mouse.isEnabled()).toBe(true);
  expect(mouse.isPaused()).toBe(false);

  // Emit event after resume - should be emitted
  stream.emit('data', Buffer.from(pressEvent));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(pressSpy).toHaveBeenCalledTimes(1);

  // Cleanup
  mouse.destroy();
});

test('Mouse should handle multiple pause/resume cycles with enable/disable', () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const pressEvent = '\x1b[<0;10;20M';
  const pressSpy = mock(() => {});

  mouse.on('press', pressSpy);
  mouse.enable();

  // Act - multiple cycles of pause/resume
  for (let i = 0; i < 3; i++) {
    // Pause
    mouse.pause();
    expect(mouse.isPaused()).toBe(true);

    // Emit while paused - should be blocked
    stream.emit('data', Buffer.from(pressEvent));
    expect(pressSpy).toHaveBeenCalledTimes(i);

    // Resume
    mouse.resume();
    expect(mouse.isPaused()).toBe(false);

    // Emit after resume - should be emitted
    stream.emit('data', Buffer.from(pressEvent));
    expect(pressSpy).toHaveBeenCalledTimes(i + 1);
  }

  // Act - disable/enable cycle
  mouse.disable();
  expect(mouse.isEnabled()).toBe(false);

  mouse.enable();
  expect(mouse.isEnabled()).toBe(true);

  // Emit event - should work (this is the 4th event: 3 from cycles + 1 after disable/enable)
  stream.emit('data', Buffer.from(pressEvent));
  expect(pressSpy).toHaveBeenCalledTimes(4);

  // Cleanup
  mouse.destroy();
});

test('Mouse eventsOf should handle pause → disable → enable → resume cycle', async () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);
  const iterator = mouse.eventsOf('press');

  try {
    mouse.enable();

    // Start the async generator
    const firstEventPromise = iterator.next();
    stream.emit('data', Buffer.from('\x1b[<0;10;20M'));
    const { value: firstEvent } = await firstEventPromise;
    expect(firstEvent.x).toBe(10);

    // Act - pause → disable → enable → resume cycle
    mouse.pause();
    mouse.disable();
    mouse.enable();

    // Emit event while still paused - should not be yielded
    stream.emit('data', Buffer.from('\x1b[<0;11;21M'));
    await Bun.sleep(50);

    // Resume
    mouse.resume();

    // Emit event after resume - should be yielded
    stream.emit('data', Buffer.from('\x1b[<0;12;22M'));

    // Assert - should get the event after resume
    const { value: secondEvent } = await iterator.next();
    expect(secondEvent.x).toBe(12);
    expect(secondEvent.y).toBe(22);
  } finally {
    // Cleanup
    await iterator.return(undefined);
    mouse.destroy();
  }
});

test('Mouse.isPaused() and isEnabled() should remain independent through all transitions', () => {
  // Arrange
  const mouse = new Mouse(makeFakeTTYStream());

  // Test all state combinations to ensure independence
  const testStates = [
    { action: () => mouse.pause(), expectedPaused: true, expectedEnabled: false },
    { action: () => mouse.resume(), expectedPaused: false, expectedEnabled: false },
    { action: () => mouse.enable(), expectedPaused: false, expectedEnabled: true },
    { action: () => mouse.pause(), expectedPaused: true, expectedEnabled: true },
    { action: () => mouse.disable(), expectedPaused: true, expectedEnabled: false },
    { action: () => mouse.resume(), expectedPaused: false, expectedEnabled: false },
    { action: () => mouse.enable(), expectedPaused: false, expectedEnabled: true },
    { action: () => mouse.disable(), expectedPaused: false, expectedEnabled: false },
  ];

  for (const state of testStates) {
    state.action();
    expect(mouse.isPaused()).toBe(state.expectedPaused);
    expect(mouse.isEnabled()).toBe(state.expectedEnabled);
  }

  // Cleanup
  mouse.destroy();
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
    const handler = (event: unknown) => {
      mouse.off('click', handler);
      expect(event).toBeDefined();
      expect((event as MouseEvent).x).toBe(10);
      expect((event as MouseEvent).y).toBe(20);
      resolve();
    };
    mouse.on('click', handler);
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

// ========== Garbage Collection Cleanup Tests ==========

// Helper to check if --expose-gc flag is available
const gcEnabled = typeof global.gc !== 'undefined';

test('Mouse should handle garbage collection cleanup', async () => {
  if (!gcEnabled) {
    console.log('Skipping test: --expose-gc flag not set. Run with: bun test --expose-gc');
    return;
  }

  // Arrange
  const stream = makeFakeTTYStream();
  const attachSpy = mock(() => {});
  const detachSpy = mock(() => {});

  // Track listener attachments
  const originalOn = stream.on.bind(stream);
  stream.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') attachSpy();
    return originalOn(event, listener);
  }) as typeof stream.on;

  const originalOff = stream.off.bind(stream);
  stream.off = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') detachSpy();
    return originalOff(event, listener);
  }) as typeof stream.off;

  // Act: Create Mouse instance, enable it, then lose reference
  {
    const mouse = new Mouse(stream);
    mouse.enable();
    expect(attachSpy).toHaveBeenCalled();
    expect(detachSpy).not.toHaveBeenCalled();
    // Mouse instance goes out of scope here
  }

  // Force garbage collection
  global.gc?.();

  // Give FinalizationRegistry callback time to execute
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Assert: FinalizationRegistry should have cleaned up the listener
  expect(detachSpy).toHaveBeenCalledTimes(1);
});

test('Mouse should handle GC correctly when explicitly disabled before collection', async () => {
  if (!gcEnabled) {
    console.log('Skipping test: --expose-gc flag not set. Run with: bun test --expose-gc');
    return;
  }

  // Arrange
  const stream = makeFakeTTYStream();
  const attachSpy = mock(() => {});
  const detachSpy = mock(() => {});

  const originalOn = stream.on.bind(stream);
  stream.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') attachSpy();
    return originalOn(event, listener);
  }) as typeof stream.on;

  const originalOff = stream.off.bind(stream);
  stream.off = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') detachSpy();
    return originalOff(event, listener);
  }) as typeof stream.off;

  // Act: Create Mouse instance, enable, then explicitly disable
  {
    const mouse = new Mouse(stream);
    mouse.enable();
    mouse.disable();
    expect(attachSpy).toHaveBeenCalled();
    expect(detachSpy).toHaveBeenCalledTimes(1);
    // Mouse instance goes out of scope here
  }

  // Force garbage collection
  global.gc?.();

  // Give FinalizationRegistry callback time to execute
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Assert: detachSpy should still be 1 (no additional GC cleanup)
  expect(detachSpy).toHaveBeenCalledTimes(1);
});

test('Mouse.disable() should be idempotent and safe to call multiple times', () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);

  // Act: Enable and disable multiple times
  mouse.enable();
  mouse.disable();
  mouse.disable();
  mouse.disable();

  // Assert: Should not throw any errors
  expect(mouse.isEnabled()).toBe(false);
  mouse.destroy();
});

test('Mouse should handle multiple enable/disable cycles with FinalizationRegistry', async () => {
  if (!gcEnabled) {
    console.log('Skipping test: --expose-gc flag not set. Run with: bun test --expose-gc');
    return;
  }

  // Arrange
  const stream = makeFakeTTYStream();
  const attachSpy = mock(() => {});
  const detachSpy = mock(() => {});

  const originalOn = stream.on.bind(stream);
  stream.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') attachSpy();
    return originalOn(event, listener);
  }) as typeof stream.on;

  const originalOff = stream.off.bind(stream);
  stream.off = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') detachSpy();
    return originalOff(event, listener);
  }) as typeof stream.off;

  // Act: Multiple enable/disable cycles
  const mouse = new Mouse(stream);
  mouse.enable();
  mouse.disable();
  mouse.enable();
  mouse.disable();
  mouse.enable();
  mouse.disable();

  // Assert: Should have 3 attaches and 3 detaches
  expect(attachSpy).toHaveBeenCalledTimes(3);
  expect(detachSpy).toHaveBeenCalledTimes(3);

  // Now lose reference and GC
  const weakRef = new WeakRef(mouse);
  const mouseRef = mouse; // Keep reference to prevent early GC
  mouseRef.destroy(); // Explicit destroy

  // Force garbage collection
  global.gc?.();
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Assert: detachSpy should still be 3 (no additional GC cleanup)
  expect(detachSpy).toHaveBeenCalledTimes(3);
  expect(weakRef.deref()).toBeDefined();
});

test('Mouse.disable() when not enabled should be safe', () => {
  // Arrange
  const stream = makeFakeTTYStream();
  const mouse = new Mouse(stream);

  // Act & Assert: Disable without ever enabling should not throw
  mouse.disable();
  mouse.disable();

  expect(mouse.isEnabled()).toBe(false);
  mouse.destroy();
});

test('Multiple Mouse instances should be garbage collected independently', async () => {
  if (!gcEnabled) {
    console.log('Skipping test: --expose-gc flag not set. Run with: bun test --expose-gc');
    return;
  }

  // Arrange
  const stream = makeFakeTTYStream();
  const attachSpy = mock(() => {});
  const detachSpy = mock(() => {});

  const originalOn = stream.on.bind(stream);
  stream.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') attachSpy();
    return originalOn(event, listener);
  }) as typeof stream.on;

  const originalOff = stream.off.bind(stream);
  stream.off = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') detachSpy();
    return originalOff(event, listener);
  }) as typeof stream.off;

  // Act: Create multiple Mouse instances, enable each, lose all references
  const weakRefs: WeakRef<Mouse>[] = [];
  {
    const mouse1 = new Mouse(stream);
    const mouse2 = new Mouse(stream);
    const mouse3 = new Mouse(stream);

    weakRefs.push(new WeakRef(mouse1));
    weakRefs.push(new WeakRef(mouse2));
    weakRefs.push(new WeakRef(mouse3));

    mouse1.enable();
    mouse2.enable();
    mouse3.enable();

    expect(attachSpy).toHaveBeenCalledTimes(3);

    // All instances go out of scope here
  }

  // Force garbage collection
  global.gc?.();

  // Give FinalizationRegistry callbacks time to execute
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Assert: All 3 instances should be cleaned up
  expect(detachSpy).toHaveBeenCalledTimes(3);
  const ref1 = weakRefs[0]?.deref();
  const ref2 = weakRefs[1]?.deref();
  const ref3 = weakRefs[2]?.deref();
  expect(ref1).toBeUndefined();
  expect(ref2).toBeUndefined();
  expect(ref3).toBeUndefined();
});

test('Mouse.destroy() should work correctly with FinalizationRegistry', async () => {
  if (!gcEnabled) {
    console.log('Skipping test: --expose-gc flag not set. Run with: bun test --expose-gc');
    return;
  }

  // Arrange
  const stream = makeFakeTTYStream();
  const attachSpy = mock(() => {});
  const detachSpy = mock(() => {});

  const originalOn = stream.on.bind(stream);
  stream.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') attachSpy();
    return originalOn(event, listener);
  }) as typeof stream.on;

  const originalOff = stream.off.bind(stream);
  stream.off = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') detachSpy();
    return originalOff(event, listener);
  }) as typeof stream.off;

  // Act: Create Mouse instance, enable, then explicitly destroy
  const weakRef: WeakRef<Mouse> = new WeakRef(
    (() => {
      const mouse = new Mouse(stream);
      mouse.enable();
      mouse.destroy();
      return mouse;
    })(),
  );

  // Force garbage collection
  global.gc?.();

  // Give FinalizationRegistry callback time to execute
  await new Promise((resolve) => setTimeout(resolve, 100));

  // Assert: detachSpy should be 1 (from destroy(), no additional GC cleanup)
  expect(detachSpy).toHaveBeenCalledTimes(1);
  expect(weakRef.deref()).toBeDefined();
});

test('Mouse.destroy() should be idempotent with FinalizationRegistry', async () => {
  if (!gcEnabled) {
    console.log('Skipping test: --expose-gc flag not set. Run with: bun test --expose-gc');
    return;
  }

  // Arrange
  const stream = makeFakeTTYStream();
  const attachSpy = mock(() => {});
  const detachSpy = mock(() => {});

  const originalOn = stream.on.bind(stream);
  stream.on = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') attachSpy();
    return originalOn(event, listener);
  }) as typeof stream.on;

  const originalOff = stream.off.bind(stream);
  stream.off = ((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'data') detachSpy();
    return originalOff(event, listener);
  }) as typeof stream.off;

  // Act: Create Mouse instance, enable, then destroy multiple times
  const mouse = new Mouse(stream);
  mouse.enable();
  mouse.destroy();
  mouse.destroy();
  mouse.destroy();

  // Assert: Should only detach once
  expect(attachSpy).toHaveBeenCalledTimes(1);
  expect(detachSpy).toHaveBeenCalledTimes(1);
});

describe('Mouse.isSupported()', () => {
  test('should return true when both stdin and stdout are TTY', () => {
    // Arrange
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalStdoutIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

    // Act
    const result = Mouse.isSupported();

    // Assert
    expect(result).toBe(true);

    // Cleanup
    Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
  });

  test('should return false when stdin is not a TTY', () => {
    // Arrange
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalStdoutIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: false, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true });

    // Act
    const result = Mouse.isSupported();

    // Assert
    expect(result).toBe(false);

    // Cleanup
    Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
  });

  test('should return false when stdout is not a TTY', () => {
    // Arrange
    const originalStdinIsTTY = process.stdin.isTTY;
    const originalStdoutIsTTY = process.stdout.isTTY;
    Object.defineProperty(process.stdin, 'isTTY', { value: true, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: false, configurable: true });

    // Act
    const result = Mouse.isSupported();

    // Assert
    expect(result).toBe(false);

    // Cleanup
    Object.defineProperty(process.stdin, 'isTTY', { value: originalStdinIsTTY, configurable: true });
    Object.defineProperty(process.stdout, 'isTTY', { value: originalStdoutIsTTY, configurable: true });
  });
});

describe('Mouse.checkSupport()', () => {
  test('should return Supported when both streams are TTY', () => {
    // Arrange
    const inputStream = {
      isTTY: true,
    } as unknown as ReadableStreamWithEncoding;
    const outputStream = {
      isTTY: true,
    } as unknown as NodeJS.WriteStream;

    // Act
    const result = Mouse.checkSupport(inputStream, outputStream);

    // Assert
    expect(result).toBe(Mouse.SupportCheckResult.Supported);
  });

  test('should return NotTTY when input stream is not TTY', () => {
    // Arrange
    const inputStream = {
      isTTY: false,
    } as unknown as ReadableStreamWithEncoding;
    const outputStream = {
      isTTY: true,
    } as unknown as NodeJS.WriteStream;

    // Act
    const result = Mouse.checkSupport(inputStream, outputStream);

    // Assert
    expect(result).toBe(Mouse.SupportCheckResult.NotTTY);
  });

  test('should return OutputNotTTY when output stream is not TTY', () => {
    // Arrange
    const inputStream = {
      isTTY: true,
    } as unknown as ReadableStreamWithEncoding;
    const outputStream = {
      isTTY: false,
    } as unknown as NodeJS.WriteStream;

    // Act
    const result = Mouse.checkSupport(inputStream, outputStream);

    // Assert
    expect(result).toBe(Mouse.SupportCheckResult.OutputNotTTY);
  });
});
