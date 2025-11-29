import { Mouse, MouseError } from '../src';

const mouse: Mouse = new Mouse();

const main = async (): Promise<void> => {
  console.log('Enable mouse events...');
  try {
    mouse.enable();
  } catch (error) {
    if (error instanceof MouseError) {
      console.error('MouseError when enabling mouse:', error.message);
      if (error.originalError) {
        console.error('Original error:', error.originalError.message);
      }
    } else {
      console.error('Unknown error when enabling mouse:', error);
    }
    process.exit(1);
  }

  console.log('Starting to stream all mouse events. Press any key to stop.');

  // Example of using the stream() method
  const _streamPromise = (async (): Promise<void> => {
    try {
      for await (const { type, event } of mouse.stream()) {
        console.log(`Stream Event: type=${type}, event=${JSON.stringify(event)}`);
      }
    } catch (error) {
      if (error instanceof MouseError) {
        console.error('MouseError in stream():', error.message);
        if (error.originalError) {
          console.error('Original error:', error.originalError.message);
        }
      } else if (error instanceof Error && error.name === 'AbortError') {
        console.log('stream() aborted.');
      } else {
        console.error('Unknown error in stream():', error);
      }
    }
  })();

  // Example of using the eventsOf() method for a specific event type
  const _eventsOfPromise = (async (): Promise<void> => {
    try {
      for await (const event of mouse.eventsOf('press')) {
        console.log(`eventsOf("press") Event: ${JSON.stringify(event)}`);
      }
    } catch (error) {
      if (error instanceof MouseError) {
        console.error(`MouseError in eventsOf("press"):`, error.message);
        if (error.originalError) {
          console.error('Original error:', error.originalError.message);
        }
      } else if (error instanceof Error && error.name === 'AbortError') {
        console.log(`eventsOf("press") aborted.`);
      } else {
        console.error(`Unknown error in eventsOf("press"):`, error);
      }
    }
  })();

  // Keep the script running until a key is pressed.
  process.stdin.on('data', (data) => {
    if (data.toString() === 'q') {
      console.log('Disabling mouse events...');
      try {
        mouse.disable();
      } catch (error) {
        if (error instanceof MouseError) {
          console.error('MouseError when disabling mouse:', error.message);
          if (error.originalError) {
            console.error('Original error:', error.originalError.message);
          }
        } else {
          console.error('Unknown error when disabling mouse:', error);
        }
      }
      process.exit(0);
    }
  });
};

main().catch(console.error);
