import { Mouse, MouseError } from '../src';

const mouse: Mouse = new Mouse();

console.log("Enabling mouse tracking... Press 'q' to exit.");

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

mouse.on('press', (event) => {
  console.log('Press event:', JSON.stringify(event));
});

mouse.on('move', (event) => {
  console.log('Move event:', JSON.stringify(event));
});

mouse.on('release', (event) => {
  console.log('Release event:', JSON.stringify(event));
});

mouse.on('drag', (event) => {
  console.log('Drag event:', JSON.stringify(event));
});

mouse.on('wheel', (event) => {
  console.log('Wheel event:', JSON.stringify(event));
});

mouse.on('click', (event) => {
  console.log('Click event:', JSON.stringify(event));
});

process.stdin.on('data', (data) => {
  if (data.toString() === 'q') {
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
    process.exit();
  }
});
