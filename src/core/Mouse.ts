import { EventEmitter } from 'node:events';
import { parseMouseEvents } from '../parser/ansiParser';
import { ANSI_CODES } from '../parser/constants';
import { MouseError, type MouseEvent, type MouseEventAction, type ReadableStreamWithEncoding } from '../types';

/**
 * Represents and manages mouse events in a TTY environment.
 * It captures mouse events by controlling the input stream and parsing ANSI escape codes.
 */
class Mouse {
  private enabled = false;
  private previousEncoding: BufferEncoding | null = null;
  private previousRawMode: boolean | null = null;
  private lastPress: MouseEvent | null = null;

  /**
   * Constructs a new Mouse instance.
   * @param inputStream The readable stream to listen for mouse events on (defaults to process.stdin).
   * @param outputStream The writable stream to send control sequences to (defaults to process.stdout).
   * @param emitter The event emitter to use for emitting mouse events (defaults to a new EventEmitter).
   */
  constructor(
    private inputStream: ReadableStreamWithEncoding = process.stdin,
    private outputStream: NodeJS.WriteStream = process.stdout,
    private emitter: EventEmitter = new EventEmitter(),
  ) {}

  private handleEvent = (data: Buffer): void => {
    try {
      const events = parseMouseEvents(data.toString());
      for (const event of events) {
        this.emitter.emit(event.action, event);

        if (event.action === 'press') {
          this.lastPress = event;
        } else if (event.action === 'release') {
          if (this.lastPress) {
            const xDiff = Math.abs(event.x - this.lastPress.x);
            const yDiff = Math.abs(event.y - this.lastPress.y);

            if (xDiff <= 1 && yDiff <= 1) {
              const clickEvent: MouseEvent = { ...event, action: 'click' };
              process.nextTick(() => {
                this.emitter.emit('click', clickEvent);
              });
            }
          }
          this.lastPress = null;
        }
      }
    } catch (err) {
      this.emitter.emit('error', err);
    }
  };

  /**
   * Enables mouse event tracking.
   *
   * This method activates mouse event capture by putting the input stream into raw mode
   * and sending the appropriate ANSI escape sequences to enable mouse tracking in the terminal.
   *
   * **TTY Requirement:** This method requires the input stream to be a TTY (terminal).
   * Mouse events cannot be captured when the input is piped, redirected, or running in a
   * non-interactive environment. Check `process.stdin.isTTY` before calling this method.
   *
   * **Error Handling:** This method throws a `MouseError` if:
   * - The input stream is not a TTY (interactive terminal)
   * - The stream cannot be put into raw mode
   * - The terminal does not support the mouse tracking ANSI codes
   *
   * **Side Effects:**
   * - The input stream is switched to raw mode (character-by-character input)
   * - The input encoding is set to UTF-8
   * - The input stream is resumed if paused
   * - ANSI escape codes are written to the output stream to enable mouse tracking
   * - The original stream settings are preserved for restoration on `disable()`
   *
   * @throws {Error} If the input stream is not a TTY
   * @throws {MouseError} If enabling mouse tracking fails
   * @see {@link disable} to disable tracking and restore the stream
   *
   * @example
   * ```ts
   * const mouse = new Mouse();
   *
   * if (process.stdin.isTTY) {
   *   mouse.enable();
   *   mouse.on('press', (event) => {
   *     console.log(`Pressed at ${event.x}, ${event.y}`);
   *   });
   * } else {
   *   console.error('Mouse tracking requires a TTY');
   * }
   * ```
   */
  public enable = (): void => {
    if (this.enabled) {
      return;
    }

    if (!this.inputStream.isTTY) {
      throw new Error('Mouse events require a TTY input stream');
    }

    try {
      this.previousRawMode = this.inputStream.isRaw ?? false;
      this.previousEncoding = this.inputStream.readableEncoding || null;

      this.enabled = true;

      this.outputStream.write(
        ANSI_CODES.mouseButton.on + ANSI_CODES.mouseDrag.on + ANSI_CODES.mouseMotion.on + ANSI_CODES.mouseSGR.on,
      );

      this.inputStream.setRawMode(true);
      this.inputStream.setEncoding('utf8');
      this.inputStream.resume();
      this.inputStream.on('data', this.handleEvent);
    } catch (err) {
      this.enabled = false;
      throw new MouseError(
        `Failed to enable mouse: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  };

  /**
   * Disables mouse event tracking.
   * This method restores the input stream to its previous state and stops listening for data.
   * @see {@link enable} to enable tracking and capture mouse events
   */
  public disable = (): void => {
    if (!this.enabled) {
      return;
    }

    try {
      this.inputStream.off('data', this.handleEvent);
      this.inputStream.pause();

      if (this.previousRawMode !== null) {
        this.inputStream.setRawMode(this.previousRawMode);
      }

      if (this.previousEncoding !== null) {
        this.inputStream.setEncoding(this.previousEncoding);
      }

      this.outputStream.write(
        ANSI_CODES.mouseSGR.off + ANSI_CODES.mouseMotion.off + ANSI_CODES.mouseDrag.off + ANSI_CODES.mouseButton.off,
      );
    } catch (err) {
      throw new MouseError(
        `Failed to disable mouse: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    } finally {
      this.enabled = false;
      this.previousRawMode = null;
      this.previousEncoding = null;
    }
  };

  /**
   * Registers a listener for a specific mouse event.
   * @param event The name of the event to listen for.
   * @param listener The callback function to execute when the event is triggered.
   * @returns The event emitter instance.
   * @see {@link off} to remove the listener
   */
  public on = (event: MouseEventAction | 'error', listener: (event: MouseEvent) => void): EventEmitter => {
    return this.emitter.on(event, listener);
  };

  /**
   * Removes a listener for a specific mouse event.
   * @param event The name of the event to stop listening for.
   * @param listener The callback function to remove.
   * @returns The event emitter instance.
   */
  public off = (event: MouseEventAction | 'error', listener: (event: MouseEvent) => void): EventEmitter => {
    return this.emitter.off(event, listener);
  };

  /**
   * Returns an async generator that yields mouse events of a specific type.
   *
   * This method provides a convenient way to iterate over mouse events using async/await syntax.
   * The async generator will yield events as they occur, allowing for clean and readable event handling code.
   *
   * **Cancellation with AbortSignal:** The async generator supports cancellation through the `signal` option.
   * When the provided AbortSignal is aborted, the generator will throw a `MouseError` and clean up all listeners.
   * This is particularly useful for implementing timeout functionality or user-initiated cancellation.
   *
   * **Queue Management:**
   * - By default, events are queued up to `maxQueue` (default: 100, max: 1000)
   * - When `latestOnly` is true, only the most recent event is buffered, dropping intermediate events
   * - This is useful for high-frequency events like 'move' where you only care about the latest position
   *
   * **Error Handling:** Errors from the mouse event stream will be thrown from the generator,
   * allowing for try/catch error handling in the iteration loop.
   *
   * **Cleanup:** The generator automatically cleans up event listeners when:
   * - The iteration loop completes (breaks or returns)
   * - An error is thrown
   * - The abort signal is triggered
   *
   * @param type The type of mouse event to listen for (e.g., 'press', 'drag', 'wheel').
   * @param options Configuration for the event stream.
   * @param options.latestOnly If true, only the latest event is buffered. Defaults to false.
   * @param options.maxQueue The maximum number of events to queue. Defaults to 100, with a maximum of 1000.
   * @param options.signal An AbortSignal to cancel the async generator and clean up resources.
   * @yields {MouseEvent} A mouse event object containing x, y, button, and action properties.
   * @throws {MouseError} When the abort signal is triggered or a mouse event stream error occurs.
   *
   * @example
   * ```ts
   * const mouse = new Mouse();
   * mouse.enable();
   *
   * // Collect 5 mouse clicks
   * const clicks: MouseEvent[] = [];
   * for await (const event of mouse.eventsOf('click')) {
   *   clicks.push(event);
   *   console.log(`Click at ${event.x}, ${event.y}`);
   *   if (clicks.length >= 5) break;
   * }
   * mouse.disable();
   * ```
   *
   * @example
   * ```ts
   * // Track mouse movement with cancellation after 5 seconds
   * const controller = new AbortController();
   * setTimeout(() => controller.abort(), 5000);
   *
   * try {
   *   for await (const event of mouse.eventsOf('move', { signal: controller.signal })) {
   *     console.log(`Mouse moved to ${event.x}, ${event.y}`);
   *   }
   * } catch (err) {
   *   if (err instanceof MouseError && err.message.includes('aborted')) {
   *     console.log('Tracking stopped after timeout');
   *   } else {
   *     throw err;
   *   }
   * }
   * ```
   *
   * @example
   * ```ts
   * // Track only the latest mouse position (for high-frequency events)
   * const mouse = new Mouse();
   * mouse.enable();
   *
   * // Display cursor position updates
   * for await (const event of mouse.eventsOf('move', { latestOnly: true })) {
   *   // Clear line and show position
   *   process.stdout.write(`\r\x1b[KPosition: ${event.x}, ${event.y}`);
   * }
   * ```
   *
   * @example
   * ```ts
   * // Implement drag detection with user cancellation
   * const controller = new AbortController();
   *
   * // Listen for Ctrl+C to cancel
   * process.stdin.setRawMode(true);
   * process.stdin.on('data', (key) => {
   *   if (key[0] === 3) { // Ctrl+C
   *     controller.abort();
   *   }
   * });
   *
   * try {
   *   for await (const event of mouse.eventsOf('drag', { signal: controller.signal })) {
   *     console.log(`Dragging at ${event.x}, ${event.y} with button ${event.button}`);
   *   }
   * } catch (err) {
   *   if (err instanceof MouseError && err.message.includes('aborted')) {
   *     console.log('\nDrag tracking cancelled by user');
   *   }
   * } finally {
   *   mouse.disable();
   * }
   * ```
   */
  public async *eventsOf(
    type: MouseEventAction,
    {
      latestOnly = false,
      maxQueue = 100,
      signal,
    }: { latestOnly?: boolean; maxQueue?: number; signal?: AbortSignal } = {},
  ): AsyncGenerator<MouseEvent> {
    if (signal?.aborted) {
      throw new Error('The operation was aborted.');
    }

    const queue: MouseEvent[] = [];
    const errorQueue: Error[] = [];
    const finalMaxQueue = Math.min(maxQueue, 1000);
    let latest: MouseEvent | null = null;
    let resolveNext: ((value: MouseEvent) => void) | null = null;
    let rejectNext: ((err: Error) => void) | null = null;

    const handler = (ev: MouseEvent): void => {
      if (resolveNext) {
        resolveNext(ev);
        resolveNext = null;
        rejectNext = null;
        latest = null;
      } else if (latestOnly) {
        latest = ev;
      } else {
        if (queue.length >= finalMaxQueue) queue.shift();
        queue.push(ev);
      }
    };

    const errorHandler = (err: Error): void => {
      const mouseError = new MouseError(`Error in mouse event stream: ${err.message}`, err);
      if (rejectNext) {
        rejectNext(mouseError);
        resolveNext = null;
        rejectNext = null;
      } else {
        errorQueue.push(mouseError);
      }
    };

    const abortHandler = (): void => {
      const err = new MouseError('The operation was aborted.');
      if (rejectNext) {
        rejectNext(err);
        resolveNext = null;
        rejectNext = null;
      } else {
        errorQueue.push(err);
      }
    };

    this.emitter.on(type, handler);
    this.emitter.on('error', errorHandler);
    signal?.addEventListener('abort', abortHandler);

    try {
      while (true) {
        if (signal?.aborted) {
          throw new MouseError('The operation was aborted.');
        }

        if (errorQueue.length > 0) {
          throw errorQueue.shift();
        }

        if (queue.length > 0) {
          const event = queue.shift();
          if (event) {
            yield event;
          }
        } else if (latest !== null) {
          const ev = latest;
          latest = null;
          yield ev;
        } else {
          // biome-ignore lint/performance/noAwaitInLoops: This is an async generator, await in loop is necessary
          yield await new Promise<MouseEvent>((resolve, reject) => {
            resolveNext = resolve;
            rejectNext = reject;
          });
        }
      }
    } finally {
      this.emitter.off(type, handler);
      this.emitter.off('error', errorHandler);
      signal?.removeEventListener('abort', abortHandler);
    }
  }

  /**
   * Returns an async generator that yields all mouse events.
   * Each yielded value is an object containing the event type and the event data.
   * @param options Configuration for the event stream.
   * @param options.latestOnly If true, only the latest event is buffered. Defaults to false.
   * @param options.maxQueue The maximum number of events to queue. Defaults to 1000.
   * @param options.signal An AbortSignal to cancel the async generator.
   * @yields {{ type: MouseEventAction; event: MouseEvent }} An object with the event type and data.
   */
  public async *stream({
    latestOnly = false,
    maxQueue = 1000,
    signal,
  }: {
    latestOnly?: boolean;
    maxQueue?: number;
    signal?: AbortSignal;
  } = {}): AsyncGenerator<{ type: MouseEventAction; event: MouseEvent }> {
    if (signal?.aborted) {
      throw new Error('The operation was aborted.');
    }

    const queue: { type: MouseEventAction; event: MouseEvent }[] = [];
    const errorQueue: Error[] = [];
    let latest: { type: MouseEventAction; event: MouseEvent } | null = null;
    let resolveNext: ((value: { type: MouseEventAction; event: MouseEvent }) => void) | null = null;
    let rejectNext: ((err: Error) => void) | null = null;

    const handlers = new Map<MouseEventAction, (ev: MouseEvent) => void>();
    const allEvents: MouseEventAction[] = ['press', 'release', 'drag', 'wheel', 'move', 'click'];

    allEvents.forEach((type) => {
      const handler = (ev: MouseEvent): void => {
        const wrapped = { type, event: ev };

        if (resolveNext) {
          resolveNext(wrapped);
          resolveNext = null;
          rejectNext = null;
          latest = null;
        } else if (latestOnly) {
          latest = wrapped;
        } else {
          if (queue.length >= maxQueue) queue.shift();
          queue.push(wrapped);
        }
      };

      handlers.set(type, handler);
      this.emitter.on(type, handler);
    });

    const errorHandler = (err: Error): void => {
      const mouseError = new MouseError(`Error in mouse event stream: ${err.message}`, err);
      if (rejectNext) {
        rejectNext(mouseError);
        resolveNext = null;
        rejectNext = null;
      } else {
        errorQueue.push(mouseError);
      }
    };
    this.emitter.on('error', errorHandler);

    const abortHandler = (): void => {
      const err = new MouseError('The operation was aborted.');
      if (rejectNext) {
        rejectNext(err);
        resolveNext = null;
        rejectNext = null;
      } else {
        errorQueue.push(err);
      }
    };
    signal?.addEventListener('abort', abortHandler);

    try {
      while (true) {
        if (signal?.aborted) {
          throw new MouseError('The operation was aborted.');
        }

        if (errorQueue.length > 0) {
          throw errorQueue.shift();
        }

        if (queue.length > 0) {
          const event = queue.shift();
          if (event) {
            yield event;
          }
        } else if (latest !== null) {
          const ev = latest;
          latest = null;
          yield ev;
        } else {
          // biome-ignore lint/performance/noAwaitInLoops: This is an async generator, await in loop is necessary
          yield await new Promise<{ type: MouseEventAction; event: MouseEvent }>((resolve, reject) => {
            resolveNext = resolve;
            rejectNext = reject;
          });
        }
      }
    } finally {
      allEvents.forEach((type) => {
        const handler = handlers.get(type);
        if (handler) {
          this.emitter.off(type, handler);
        }
      });
      this.emitter.off('error', errorHandler);
      signal?.removeEventListener('abort', abortHandler);
    }
  }

  /**
   * Checks if mouse event tracking is currently enabled.
   * @returns {boolean} True if enabled, false otherwise.
   */
  public isEnabled(): boolean {
    return this.enabled;
  }

  /**
   * Disables mouse tracking and removes all event listeners.
   * This is a cleanup method to ensure no resources are left hanging.
   */
  public destroy(): void {
    this.disable();
    this.emitter.removeAllListeners();
  }
}

export { Mouse };
