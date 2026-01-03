import { Mouse, MouseError, type MouseOptions } from '../src';

/**
 * This example demonstrates how to configure custom click detection thresholds.
 *
 * The click distance threshold determines how close the press and release positions
 * must be to qualify as a click. A lower threshold means more strict detection,
 * while a higher threshold allows more movement between press and release.
 *
 * Run this example multiple times with different threshold values to see the difference:
 * - bun run examples/customThreshold.ts
 *
 * Try changing the THRESHOLD constant below to experiment with different values:
 * - 0: Requires exact same position (very strict)
 * - 1: Default behavior (slight movement allowed)
 * - 5: Lenient (allows noticeable movement)
 * - 10+: Very lenient (allows significant movement)
 */

// Configure the threshold for this example run
const THRESHOLD: number = 0;

// Create MouseOptions with the custom threshold
const options: MouseOptions = {
  clickDistanceThreshold: THRESHOLD,
};

const mouse: Mouse = new Mouse(process.stdin, process.stdout, undefined, options);

console.log(`╔═══════════════════════════════════════════════════════════════╗`);
console.log(`║   Custom Click Detection Threshold Example                    ║`);
console.log(`╠═══════════════════════════════════════════════════════════════╣`);
console.log(`║                                                               ║`);
console.log(`║   Current threshold: ${THRESHOLD.toString().padEnd(41)}║`);
console.log(`║                                                               ║`);

if (THRESHOLD === 0) {
  console.log(`║   🎯 STRICT MODE: Click requires exact position match         ║`);
  console.log(`║       Press and release must be at the SAME cell              ║`);
} else if (THRESHOLD === 1) {
  console.log(`║   📊 DEFAULT MODE: Standard click detection                  ║`);
  console.log(`║       Allows 1 cell of movement in any direction            ║`);
} else if (THRESHOLD <= 5) {
  console.log(`║   🔄 LENIENT MODE: Relaxed click detection                   ║`);
  console.log(`║       Allows up to ${THRESHOLD} cells of movement              ║`);
} else {
  console.log(`║   ⚠️  VERY LENIENT: Allows significant movement              ║`);
  console.log(`║       Allows up to ${THRESHOLD} cells of movement              ║`);
}

console.log(`║                                                               ║`);
console.log(`║   Instructions:                                               ║`);
console.log(`║   1. Click anywhere in the terminal                           ║`);
console.log(`║   2. Try moving the mouse slightly during clicks              ║`);
console.log(`║   3. Observe which movements register as clicks               ║`);
console.log(`║   4. Press 'q' to exit                                        ║`);
console.log(`║                                                               ║`);
console.log(`╚═══════════════════════════════════════════════════════════════╝`);
console.log();

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

// Track press positions to calculate distances
let lastPressPosition: { x: number; y: number } | null = null;

mouse.on('press', (event) => {
  lastPressPosition = { x: event.x, y: event.y };
  console.log(`🖱️  PRESS at (${event.x.toString().padStart(3)}, ${event.y.toString().padStart(3)})`);
});

mouse.on('release', (event) => {
  if (lastPressPosition) {
    const xDiff = Math.abs(event.x - lastPressPosition.x);
    const yDiff = Math.abs(event.y - lastPressPosition.y);
    console.log(
      `  ⬆️  RELEASE at (${event.x.toString().padStart(3)}, ${event.y.toString().padStart(3)}) - Distance: X=${xDiff}, Y=${yDiff}`,
    );
  }
});

mouse.on('click', (event) => {
  console.log(`  ✅ CLICK detected at (${event.x.toString().padStart(3)}, ${event.y.toString().padStart(3)})`);
  console.log();
  lastPressPosition = null;
});

// Also track drag events to see movement during button hold
mouse.on('drag', (event) => {
  if (lastPressPosition) {
    const xDiff = Math.abs(event.x - lastPressPosition.x);
    const yDiff = Math.abs(event.y - lastPressPosition.y);
    // Only log significant movements to reduce noise
    if (xDiff > 0 || yDiff > 0) {
      console.log(
        `  ↔️  DRAG to (${event.x.toString().padStart(3)}, ${event.y.toString().padStart(3)}) - Press distance: X=${xDiff}, Y=${yDiff}`,
      );
    }
  }
});

process.stdin.on('data', (data) => {
  if (data.toString() === 'q') {
    console.log();
    console.log('Disabling mouse tracking...');
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
    console.log('Goodbye!');
    process.exit(0);
  }
});

// Handle process termination gracefully
process.on('SIGINT', () => {
  console.log();
  console.log('Received SIGINT, disabling mouse tracking...');
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
});
