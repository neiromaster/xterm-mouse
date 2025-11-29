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
   * This method puts the input stream into raw mode and starts listening for data.
   * It will throw an error if the input stream is not a TTY.
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
   * @param type The type of mouse event to listen for.
   * @param options Configuration for the event stream.
   * @param options.latestOnly If true, only the latest event is buffered. Defaults to false.
   * @param options.maxQueue The maximum number of events to queue. Defaults to 100, with a maximum of 1000.
   * @param options.signal An AbortSignal to cancel the async generator.
   * @yields {MouseEvent} A mouse event object.
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
    const allEvents: MouseEventAction[] = ['press', 'release', 'drag', 'wheel', 'move'];

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
