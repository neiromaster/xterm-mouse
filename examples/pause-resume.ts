import { Mouse, MouseError } from '../src';

/**
 * This example demonstrates the pause/resume functionality of the Mouse class.
 *
 * Key concepts:
 * - pause() stops event emission without disabling terminal mouse mode
 * - resume() resumes event emission without re-enabling terminal mouse mode
 * - This is faster than disable()/enable() for temporary event suppression
 * - pause/resume state is independent from enable/disable state
 */

const mouse: Mouse = new Mouse();

console.log('=== Mouse Pause/Resume Example ===\n');

// Setup event listeners
mouse.on('press', (event) => {
  console.log(`[PRESS] Button: ${event.button}, Position: (${event.x}, ${event.y})`);
});

mouse.on('move', (event) => {
  console.log(`[MOVE] Position: (${event.x}, ${event.y})`);
});

mouse.on('release', (event) => {
  console.log(`[RELEASE] Button: ${event.button}, Position: (${event.x}, ${event.y})`);
});

const main = async (): Promise<void> => {
  try {
    // Enable mouse tracking
    console.log('1. Enabling mouse tracking...');
    mouse.enable();
    console.log('   Mouse enabled. Move the mouse and click to see events.\n');

    // Wait a bit for user to see events
    await sleep(3000);

    // Pause event emission
    console.log('2. Pausing event emission (terminal mouse mode still active)...');
    mouse.pause();
    console.log('   Mouse paused. Try moving/clicking - NO events will be emitted.\n');

    // Wait a bit for user to verify no events
    await sleep(3000);

    // Resume event emission
    console.log('3. Resuming event emission...');
    mouse.resume();
    console.log('   Mouse resumed. Events will be emitted again.\n');

    // Wait a bit for user to see events
    await sleep(3000);

    // Demonstrate state independence
    console.log('4. Demonstrating state independence...');
    console.log('   Pausing before disabling (pause state is independent)...');
    mouse.pause();

    console.log('   Disabling mouse tracking...');
    mouse.disable();
    console.log(`   Paused state preserved: ${mouse.isPaused()}`);

    console.log('   Re-enabling mouse tracking...');
    mouse.enable();
    console.log(`   Still paused: ${mouse.isPaused()}`);
    console.log('   Events will NOT be emitted until resume() is called.\n');

    await sleep(2000);

    // Resume to restore event emission
    console.log('5. Resuming event emission...');
    mouse.resume();
    console.log('   Events will be emitted again.\n');

    // Demonstrate practical use case with async generator
    console.log('6. Demonstrating pause/resume with async generator (eventsOf)...');
    console.log('   Starting to stream press events. Press "p" to pause, "r" to resume.\n');

    // Start streaming press events in background
    const streamPromise = (async (): Promise<void> => {
      try {
        for await (const event of mouse.eventsOf('press')) {
          console.log(`   [STREAM] Press at (${event.x}, ${event.y})`);
        }
      } catch (error) {
        if (error instanceof MouseError) {
          console.error('   MouseError in stream:', error.message);
        } else {
          console.error('   Unknown error in stream:', error);
        }
      }
    })();

    // Handle keyboard input
    setupKeyboardControls();

    // Wait for exit
    await streamPromise;
  } catch (error) {
    if (error instanceof MouseError) {
      console.error('MouseError:', error.message);
      if (error.originalError) {
        console.error('Original error:', error.originalError.message);
      }
    } else {
      console.error('Unknown error:', error);
    }
    process.exit(1);
  }
};

/**
 * Setup keyboard controls for interactive demonstration
 */
function setupKeyboardControls(): void {
  console.log('Keyboard Controls:');
  console.log('  [p] - Pause event emission');
  console.log('  [r] - Resume event emission');
  console.log('  [s] - Show current state');
  console.log('  [q] - Quit\n');

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  process.stdin.on('data', (data) => {
    const key = data.toString();

    switch (key) {
      case 'p':
        mouse.pause();
        console.log('\n>>> Paused event emission (no events will be emitted) <<<\n');
        break;

      case 'r':
        mouse.resume();
        console.log('\n>>> Resumed event emission (events will be emitted) <<<\n');
        break;

      case 's':
        console.log(`\n>>> Current State: Enabled=${mouse.isEnabled()}, Paused=${mouse.isPaused()} <<<\n`);
        break;

      case 'q':
        console.log('\n=== Exiting ===');
        cleanup();
        break;

      default:
        // Ignore other keys
        break;
    }
  });
}

/**
 * Cleanup and exit
 */
function cleanup(): void {
  try {
    mouse.disable();
  } catch (error) {
    if (error instanceof MouseError) {
      console.error('MouseError when disabling mouse:', error.message);
    }
  }
  process.stdin.setRawMode(false);
  process.stdin.pause();
  process.exit(0);
}

/**
 * Helper function to sleep for a specified duration
 */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Run the example
main().catch(console.error);
