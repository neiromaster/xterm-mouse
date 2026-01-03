import { EventEmitter } from 'node:events';
import { parseMouseEvents } from '../parser/ansiParser';
import { ANSI_CODES } from '../parser/constants';
import {
  type ListenerFor,
  MouseError,
  type MouseEvent,
  type MouseEventAction,
  type MouseOptions,
  type ReadableStreamWithEncoding,
} from '../types';

/**
 * FinalizationRegistry for automatic cleanup of Mouse instances.
 *
 * When a Mouse instance is garbage collected without explicit cleanup,
 * this registry ensures that:
 * - The stdin 'data' event listener is removed
 * - The input stream state is restored (raw mode disabled, stream paused)
 * - ANSI disable codes are sent to the terminal
 *
 * This prevents memory leaks from accumulated event listeners when Mouse instances
 * are not properly destroyed.
 */
const mouseCleanupRegistry: FinalizationRegistry<{
  inputStream: ReadableStreamWithEncoding;
  handleEvent: (data: Buffer) => void;
  outputStream: NodeJS.WriteStream;
  previousRawMode: boolean | null;
  isRaw: boolean | null;
}> = new FinalizationRegistry(
  (heldValue: {
    inputStream: ReadableStreamWithEncoding;
    handleEvent: (data: Buffer) => void;
    outputStream: NodeJS.WriteStream;
    previousRawMode: boolean | null;
    isRaw: boolean | null;
  }) => {
    try {
      heldValue.inputStream.off('data', heldValue.handleEvent);
    } catch {
      // Ignore errors during GC cleanup
    }

    try {
      if (heldValue.isRaw) {
        heldValue.inputStream.setRawMode(false);
      }
      heldValue.inputStream.pause();
    } catch {
      // Ignore errors during GC cleanup
    }

    try {
      heldValue.outputStream.write(
        ANSI_CODES.mouseSGR.off + ANSI_CODES.mouseMotion.off + ANSI_CODES.mouseDrag.off + ANSI_CODES.mouseButton.off,
      );
    } catch {
      // Ignore errors during GC cleanup
    }
  },
);

/**
 * Represents and manages mouse events in a TTY environment.
 * It captures mouse events by controlling the input stream and parsing ANSI escape codes.
 *
 * **Automatic Cleanup:**
 * Mouse instances automatically register for cleanup when `enable()` is called.
 * If a Mouse instance is garbage collected without explicit cleanup via `disable()` or `destroy()`,
 * the FinalizationRegistry ensures that stdin event listeners are removed to prevent memory leaks.
 *
 * **Recommended Cleanup:**
 * Despite automatic cleanup, it's still recommended to explicitly call `destroy()` when done
 * with a Mouse instance for immediate and predictable resource release.
 */
class Mouse {
  private enabled = false;
  private paused = false;
  private previousEncoding: BufferEncoding | null = null;
  private previousRawMode: boolean | null = null;
  private lastPress: MouseEvent | null = null;
  private clickDistanceThreshold: number;
  private cleanupToken: { instance: Mouse } | null = null;

  /**
   * Constructs a new Mouse instance.
   * @param inputStream The readable stream to listen for mouse events on (defaults to process.stdin).
   * @param outputStream The writable stream to send control sequences to (defaults to process.stdout).
   * @param emitter The event emitter to use for emitting mouse events (defaults to a new EventEmitter).
   * @param options Optional configuration options for mouse behavior.
   * @param options.clickDistanceThreshold Maximum allowed distance (in cells) between press and release
   * to qualify as a click. Defaults to 1, meaning press and release must be within 1 cell in both
   * X and Y directions. Set to 0 to require exact same position, or higher values to allow more movement.
   *
   * @example
   * ```ts
   * // Create a Mouse instance with default settings
   * const mouse = new Mouse();
   *
   * // Create a Mouse instance with a custom click distance threshold
   * const sensitiveMouse = new Mouse(process.stdin, process.stdout, new EventEmitter(), {
   *   clickDistanceThreshold: 0, // Require exact position for clicks
   * });
   *
   * // Create a Mouse instance with a more lenient click threshold
   * const lenientMouse = new Mouse(process.stdin, process.stdout, new EventEmitter(), {
   *   clickDistanceThreshold: 5, // Allow up to 5 cells of movement
   * });
   * ```
   */
  constructor(
    private inputStream: ReadableStreamWithEncoding = process.stdin,
    private outputStream: NodeJS.WriteStream = process.stdout,
    private emitter: EventEmitter = new EventEmitter(),
    private options?: MouseOptions,
  ) {
    this.clickDistanceThreshold = this.options?.clickDistanceThreshold ?? 1;
  }

  /**
   * Result type for terminal capability checks.
   */
  static readonly SupportCheckResult = {
    /** Mouse events are supported */
    Supported: 'supported',
    /** Input stream is not a TTY */
    NotTTY: 'not_tty',
    /** Output stream is not a TTY */
    OutputNotTTY: 'output_not_tty',
  } as const;

  /**
   * Checks if the current terminal environment supports mouse events.
   *
   * This is a convenience method that checks if `process.stdin.isTTY` is true,
   * which is the primary requirement for mouse event tracking.
   *
   * **Use Cases:**
   * - Before creating a Mouse instance in environments that may not support TTY
   * - To provide better error messages in CLI tools
   * - To conditionally enable mouse features in applications
   *
   * **Note:** This only checks the default `process.stdin` and `process.stdout`.
   * If you're using custom streams, use `checkSupport()` instead.
   *
   * @returns true if the terminal likely supports mouse events
   *
   * @example
   * ```ts
   * import { Mouse } from 'xterm-mouse';
   *
   * if (Mouse.isSupported()) {
   *   const mouse = new Mouse();
   *   mouse.enable();
   * } else {
   *   console.log('Mouse events not supported in this environment');
   * }
   * ```
   */
  static isSupported(): boolean {
    return process.stdin.isTTY === true && process.stdout.isTTY === true;
  }

  /**
   * Performs a detailed check of terminal mouse event support.
   *
   * This method provides more information than `isSupported()` by checking
   * specific streams and returning the reason if support is not available.
   *
   * **Use Cases:**
   * - Need detailed information about why mouse events aren't supported
   * - Checking custom streams
   * - Providing user-friendly error messages
   *
   * @param inputStream The input stream to check (defaults to process.stdin)
   * @param outputStream The output stream to check (defaults to process.stdout)
   * @returns A result from SupportCheckResult indicating support status
   *
   * @example
   * ```ts
   * import { Mouse } from 'xterm-mouse';
   *
   * const result = Mouse.checkSupport();
   * if (result === Mouse.SupportCheckResult.Supported) {
   *   console.log('Mouse events are supported!');
   * } else if (result === Mouse.SupportCheckResult.NotTTY) {
   *   console.error('Not running in a terminal');
   * } else if (result === Mouse.SupportCheckResult.OutputNotTTY) {
   *   console.error('Output is not a terminal');
   * }
   * ```
   */
  static checkSupport(
    inputStream: ReadableStreamWithEncoding = process.stdin,
    outputStream: NodeJS.WriteStream = process.stdout,
  ): string {
    if (!inputStream.isTTY) {
      return Mouse.SupportCheckResult.NotTTY;
    }
    if (!outputStream.isTTY) {
      return Mouse.SupportCheckResult.OutputNotTTY;
    }
    return Mouse.SupportCheckResult.Supported;
  }

  private handleEvent = (data: Buffer): void => {
    if (this.paused) {
      return;
    }

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

            if (xDiff <= this.clickDistanceThreshold && yDiff <= this.clickDistanceThreshold) {
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
   * **Automatic Cleanup:**
   * When `enable()` is called, the Mouse instance registers with a FinalizationRegistry.
   * If the instance is garbage collected without explicit cleanup via `disable()` or `destroy()`,
   * the registry will automatically remove the stdin listener and restore stream state to prevent
   * memory leaks. This is a safety net - explicit cleanup via `destroy()` is still recommended
   * for immediate and predictable resource release.
   *
   * **Side Effects:**
   * - The input stream is switched to raw mode (character-by-character input)
   * - The input encoding is set to UTF-8
   * - The input stream is resumed if paused
   * - ANSI escape codes are written to the output stream to enable mouse tracking
   * - The original stream settings are preserved for restoration on `disable()`
   * - The Mouse instance is registered with the FinalizationRegistry for automatic cleanup
   *
   * @throws {Error} If the input stream is not a TTY
   * @throws {MouseError} If enabling mouse tracking fails
   * @see {@link disable} to disable tracking and restore the stream
   * @see {@link destroy} for recommended cleanup method
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

      this.cleanupToken = { instance: this };
      mouseCleanupRegistry.register(
        this,
        {
          inputStream: this.inputStream,
          handleEvent: this.handleEvent,
          outputStream: this.outputStream,
          previousRawMode: this.previousRawMode,
          isRaw: this.inputStream.isRaw ?? false,
        },
        this.cleanupToken,
      );
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
      // Unregister from FinalizationRegistry before cleanup
      if (this.cleanupToken) {
        mouseCleanupRegistry.unregister(this.cleanupToken);
        this.cleanupToken = null;
      }

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
   * Pauses mouse event emission without disabling terminal mouse mode.
   *
   * This method temporarily stops the emission of mouse events while keeping
   * the terminal mouse mode active. This is useful when you want to temporarily
   * ignore mouse events without the overhead of disabling and re-enabling mouse tracking.
   *
   * **Idempotent:** Calling this method when already paused has no effect.
   *
   * **No Terminal State Changes:** Unlike {@link disable}, this method does not:
   * - Send ANSI escape codes to the terminal
   * - Modify the input stream's raw mode
   * - Change the input stream encoding
   * - Remove event listeners from the input stream
   *
   * **Difference from disable():**
   * - pause(): Stops event emission only, terminal mouse mode remains active
   * - disable(): Stops event emission AND deactivates terminal mouse mode
   *
   * @see {@link resume} to resume event emission
   * @see {@link disable} to completely disable mouse tracking
   * @see {@link isPaused} to check if currently paused
   *
   * @example
   * ```ts
   * const mouse = new Mouse();
   * mouse.enable();
   *
   * // Temporarily ignore mouse events during an operation
   * mouse.pause();
   * // ... perform operations that should not trigger mouse events
   * mouse.resume();
   * ```
   *
   * @example
   * ```ts
   * // Comparing pause() vs disable()
   * const mouse = new Mouse();
   * mouse.enable();
   *
   * // Using pause(): Fast, no terminal overhead
   * mouse.pause();
   * performQuickOperation();
   * mouse.resume(); // Terminal mouse mode was never disabled
   *
   * // VS using disable(): Slower, terminal overhead
   * mouse.disable();
   * performQuickOperation();
   * mouse.enable(); // Had to re-enable terminal mouse mode
   * ```
   */
  public pause = (): void => {
    if (this.paused) {
      return;
    }

    this.paused = true;
  };

  /**
   * Resumes mouse event emission without modifying terminal mouse mode.
   *
   * This method resumes the emission of mouse events after they were paused
   * using {@link pause}. The terminal mouse mode remains active throughout.
   *
   * **Idempotent:** Calling this method when not paused has no effect.
   *
   * **No Terminal State Changes:** Unlike {@link enable}, this method does not:
   * - Send ANSI escape codes to the terminal
   * - Modify the input stream's raw mode
   * - Change the input stream encoding
   * - Add event listeners to the input stream
   *
   * **Difference from enable():**
   * - resume(): Resumes event emission only, assumes terminal mouse mode is already active
   * - enable(): Activates terminal mouse mode AND resumes event emission
   *
   * @see {@link pause} to pause event emission
   * @see {@link enable} to completely enable mouse tracking
   * @see {@link isPaused} to check if currently paused
   *
   * @example
   * ```ts
   * const mouse = new Mouse();
   * mouse.enable();
   *
   * // Temporarily ignore mouse events during an operation
   * mouse.pause();
   * // ... perform operations that should not trigger mouse events
   * mouse.resume(); // Events will now be emitted again
   * ```
   *
   * @example
   * ```ts
   * // Comparing resume() vs enable()
   * const mouse = new Mouse();
   * mouse.enable();
   *
   * // Pause and resume: Fast state change
   * mouse.pause();
   * performOperation();
   * mouse.resume(); // No terminal overhead
   *
   * // VS disable and enable: Slower, re-enables terminal
   * mouse.disable();
   * performOperation();
   * mouse.enable(); // Re-enables terminal mouse mode (ANSI codes, raw mode)
   * ```
   */
  public resume = (): void => {
    if (!this.paused) {
      return;
    }

    this.paused = false;
  };

  /**
   * Registers a listener for a specific mouse event.
   *
   * **Type Inference:**
   * This method uses TypeScript's type inference to provide accurate types for the event parameter
   * based on the event name. For example:
   * - For 'wheel' events, `event.button` is typed as `'wheel-up' | 'wheel-down' | 'wheel-left' | 'wheel-right'`
   * - For 'move' events, `event.button` is typed as `'none'`
   * - For 'drag' events, `event.button` excludes wheel buttons
   *
   * @param event The name of the event to listen for.
   * @param listener The callback function to execute when the event is triggered.
   * @returns The event emitter instance.
   * @see {@link off} to remove the listener
   *
   * @example
   * ```ts
   * const mouse = new Mouse();
   * mouse.enable();
   *
   * // TypeScript knows event.button is a wheel button type here
   * mouse.on('wheel', (event) => {
   *   console.log(event.button); // 'wheel-up' | 'wheel-down' | 'wheel-left' | 'wheel-right'
   * });
   *
   * // TypeScript knows event.button is 'none' here
   * mouse.on('move', (event) => {
   *   console.log(event.button); // 'none'
   * });
   * ```
   */
  public on = <T extends MouseEventAction | 'error'>(
    event: T,
    listener: T extends 'error' ? (error: Error) => void : ListenerFor<T>,
  ): EventEmitter => {
    return this.emitter.on(event, listener as Parameters<typeof this.emitter.on>[1]);
  };

  /**
   * Removes a listener for a specific mouse event.
   *
   * **Type Inference:**
   * This method uses the same type inference as `on()` to ensure type safety when removing listeners.
   *
   * @param event The name of the event to stop listening for.
   * @param listener The callback function to remove.
   * @returns The event emitter instance.
   * @see {@link on} to add a listener
   *
   * @example
   * ```ts
   * const mouse = new Mouse();
   * const handler = (event: EventByAction<'press'>) => {
   *   console.log(`Pressed at ${event.x}, ${event.y}`);
   * };
   *
   * mouse.on('press', handler);
   * mouse.off('press', handler);
   * ```
   */
  public off = <T extends MouseEventAction | 'error'>(
    event: T,
    listener: T extends 'error' ? (error: Error) => void : ListenerFor<T>,
  ): EventEmitter => {
    return this.emitter.off(event, listener as Parameters<typeof this.emitter.off>[1]);
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
   * Checks if mouse event emission is currently paused.
   *
   * This method returns the current pause state of mouse event emission.
   * When paused, no mouse events will be emitted, but terminal mouse mode
   * remains active.
   *
   * **Independent from enabled state:** The paused state is independent from
   * the enabled state. You can have:
   * - enabled=true, paused=false: Normal operation, events are emitted
   * - enabled=true, paused=true: Terminal mouse mode active, but no events emitted
   * - enabled=false, paused=false: Terminal mouse mode inactive, no events emitted
   * - enabled=false, paused=true: Terminal mouse mode inactive, pause state preserved
   *
   * **Difference from isEnabled():**
   * - isPaused(): Checks if event emission is paused (state flag only)
   * - isEnabled(): Checks if terminal mouse mode is active (includes terminal state)
   *
   * @returns {boolean} True if event emission is paused, false otherwise.
   * @see {@link pause} to pause event emission
   * @see {@link resume} to resume event emission
   * @see {@link isEnabled} to check if terminal mouse mode is enabled
   *
   * @example
   * ```ts
   * const mouse = new Mouse();
   * mouse.enable();
   *
   * console.log(mouse.isPaused()); // false
   *
   * mouse.pause();
   * console.log(mouse.isPaused()); // true
   *
   * mouse.resume();
   * console.log(mouse.isPaused()); // false
   * ```
   *
   * @example
   * ```ts
   * // Comparing isPaused() vs isEnabled()
   * const mouse = new Mouse();
   *
   * mouse.enable();
   * console.log(mouse.isEnabled()); // true (terminal mouse mode active)
   * console.log(mouse.isPaused());  // false (events are being emitted)
   *
   * mouse.pause();
   * console.log(mouse.isEnabled()); // true (terminal mouse mode still active!)
   * console.log(mouse.isPaused());  // true (events are paused)
   *
   * mouse.disable();
   * console.log(mouse.isEnabled()); // false (terminal mouse mode inactive)
   * console.log(mouse.isPaused());  // true (pause state is preserved)
   * ```
   *
   * @example
   * ```ts
   * // Practical use: Check state before performing operations
   * const mouse = new Mouse();
   * mouse.enable();
   *
   * function performSensitiveOperation() {
   *   // Save current state
   *   const wasPaused = mouse.isPaused();
   *
   *   // Ensure we're paused during the operation
   *   mouse.pause();
   *
   *   // ... perform operation ...
   *
   *   // Restore previous state
   *   if (!wasPaused) {
   *     mouse.resume();
   *   }
   * }
   * ```
   */
  public isPaused(): boolean {
    return this.paused;
  }

  /**
   * Disables mouse tracking and removes all event listeners.
   *
   * **Recommended for Immediate Cleanup:**
   * This method is the recommended way to clean up a Mouse instance when you're done with it.
   * While automatic cleanup via FinalizationRegistry prevents memory leaks on garbage collection,
   * calling `destroy()` explicitly ensures immediate and predictable resource release with
   * no dependency on GC timing.
   *
   * **Idempotent:** Calling this method multiple times is safe and has no additional effect.
   *
   * **Side Effects:**
   * - Calls `disable()` to stop mouse tracking and restore stream state
   * - Unregisters from the FinalizationRegistry to prevent duplicate cleanup
   * - Removes all event listeners from the internal event emitter
   * - Sets the Mouse instance to a non-functional state
   *
   * @see {@link disable} to disable mouse tracking without removing event listeners
   * @see {@link enable} to enable mouse tracking
   *
   * @example
   * ```ts
   * const mouse = new Mouse();
   * mouse.enable();
   *
   * // ... use mouse instance ...
   *
   * // Always destroy when done for immediate cleanup
   * mouse.destroy();
   * ```
   */
  public destroy(): void {
    this.disable();

    if (this.cleanupToken) {
      mouseCleanupRegistry.unregister(this.cleanupToken);
      this.cleanupToken = null;
    }

    this.emitter.removeAllListeners();
  }
}

export { Mouse };
