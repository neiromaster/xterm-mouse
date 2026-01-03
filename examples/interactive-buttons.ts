/**
 * Interactive Button Demo
 *
 * Demonstrates clickable buttons with visual feedback using ANSI escape codes.
 * Features:
 * - Multiple clickable buttons
 * - Hover effects (highlight when mouse over)
 * - Click animation (visual feedback on press)
 * - Status bar showing current action
 */

import readline from 'node:readline';
import { Mouse, MouseError } from '../src';

// ANSI Escape Codes for terminal control
const ANSI = {
  // Cursor positioning
  saveCursor: '\x1b[s',
  restoreCursor: '\x1b[u',
  moveTo: (x: number, y: number) => `\x1b[${y};${x}H`,
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',

  // Screen clearing
  clearScreen: '\x1b[2J',
  clearLine: '\x1b[K',
  clearToStart: '\x1b[1J',
  clearToEnd: '\x1b[0J',

  // Colors (foreground)
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  bgBrightBlack: '\x1b[100m',
  bgBrightRed: '\x1b[101m',
  bgBrightGreen: '\x1b[102m',
  bgBrightYellow: '\x1b[103m',
  bgBrightBlue: '\x1b[104m',

  // Text styles
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',
  blink: '\x1b[5m',
  inverse: '\x1b[7m',
  hidden: '\x1b[8m',
  strikethrough: '\x1b[9m',
} as const;

type Button = {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  color: string;
  bgColor: string;
  hoverBgColor: string;
  activeBgColor: string;
  isHovered: boolean;
  isActive: boolean;
};

class InteractiveButtonDemo {
  private mouse: Mouse;
  private buttons: Button[] = [];
  private statusMessage = 'Move mouse over buttons and click to interact';
  private clickCount = 0;

  constructor() {
    this.mouse = new Mouse();
  }

  public async run(): Promise<void> {
    try {
      this.mouse.enable();
    } catch (error) {
      if (error instanceof MouseError) {
        console.error('MouseError:', error.message);
      }
      process.exit(1);
    }

    // Hide cursor
    process.stdout.write(ANSI.hideCursor);

    // Initialize buttons
    this.initButtons();

    // Draw initial UI
    this.drawUI();

    // Setup event handlers
    this.setupEventHandlers();

    // Setup keyboard exit
    this.setupKeyboardHandler();

    // biome-ignore lint/security/noSecrets: Demo application with no actual secrets
    console.log('\nInteractive Button Demo - Press ESC or q to exit\n');
  }

  private initButtons(): void {
    const startX = 10;
    const startY = 5;
    const buttonWidth = 20;
    const gap = 5;

    this.buttons = [
      {
        id: 'confirm',
        label: 'Confirm',
        x: startX,
        y: startY,
        width: buttonWidth,
        color: ANSI.white,
        bgColor: ANSI.bgGreen,
        hoverBgColor: ANSI.bgBrightGreen,
        activeBgColor: ANSI.bgBrightGreen,
        isHovered: false,
        isActive: false,
      },
      {
        id: 'cancel',
        label: 'Cancel',
        x: startX + buttonWidth + gap,
        y: startY,
        width: buttonWidth,
        color: ANSI.white,
        bgColor: ANSI.bgRed,
        hoverBgColor: ANSI.bgBrightRed,
        activeBgColor: ANSI.bgBrightRed,
        isHovered: false,
        isActive: false,
      },
      {
        id: 'info',
        label: 'Info',
        x: startX + (buttonWidth + gap) * 2,
        y: startY,
        width: buttonWidth,
        color: ANSI.white,
        bgColor: ANSI.bgBlue,
        hoverBgColor: ANSI.bgBrightBlue,
        activeBgColor: ANSI.bgBrightBlue,
        isHovered: false,
        isActive: false,
      },
      {
        id: 'reset',
        label: 'Reset Counter',
        x: startX + buttonWidth + gap,
        y: startY + 4,
        width: buttonWidth,
        color: ANSI.white,
        bgColor: ANSI.bgYellow,
        hoverBgColor: ANSI.bgBrightYellow,
        activeBgColor: ANSI.bgBrightYellow,
        isHovered: false,
        isActive: false,
      },
    ];
  }

  private setupEventHandlers(): void {
    // Track mouse movement for hover effects
    this.mouse.on('move', (event) => {
      let needsRedraw = false;

      for (const button of this.buttons) {
        const wasHovered = button.isHovered;
        button.isHovered = this.isInsideButton(event.x, event.y, button);

        if (button.isHovered !== wasHovered) {
          needsRedraw = true;
        }
      }

      if (needsRedraw) {
        this.drawButtons();
        this.updateStatus('Hovering over button');
      }
    });

    // Handle button press (highlight)
    this.mouse.on('press', (event) => {
      for (const button of this.buttons) {
        if (this.isInsideButton(event.x, event.y, button)) {
          button.isActive = true;
          this.drawButton(button);
          this.updateStatus(`Pressed: ${button.label}`);
        }
      }
    });

    // Handle button release and click
    this.mouse.on('release', (event) => {
      for (const button of this.buttons) {
        if (button.isActive) {
          button.isActive = false;
          this.drawButton(button);

          if (this.isInsideButton(event.x, event.y, button)) {
            this.handleButtonClick(button);
          }
        }
      }
    });
  }

  private handleButtonClick(button: Button): void {
    this.clickCount++;

    switch (button.id) {
      case 'confirm':
        this.updateStatus(`Confirmed! (Click #${this.clickCount})`);
        break;
      case 'cancel':
        this.updateStatus(`Cancelled! (Click #${this.clickCount})`);
        break;
      case 'info':
        this.updateStatus(`Info: Clicked ${this.clickCount} times total`);
        break;
      case 'reset':
        this.clickCount = 0;
        this.updateStatus('Counter reset!');
        break;
    }
  }

  private isInsideButton(x: number, y: number, button: Button): boolean {
    return x >= button.x && x < button.x + button.width && y >= button.y && y < button.y + 3;
  }

  private drawUI(): void {
    // Clear screen
    process.stdout.write(ANSI.clearScreen);
    process.stdout.write(ANSI.moveTo(1, 1));

    // Draw title
    process.stdout.write(
      ANSI.moveTo(1, 2) +
        ANSI.bold +
        ANSI.cyan +
        '╔════════════════════════════════════════════════════════════╗' +
        ANSI.reset,
    );
    process.stdout.write(
      ANSI.moveTo(1, 3) +
        ANSI.bold +
        ANSI.cyan +
        '║' +
        ANSI.reset +
        '          ' +
        ANSI.bold +
        '🖱️  Interactive Button Demo' +
        ANSI.reset +
        '                       ' +
        ANSI.bold +
        ANSI.cyan +
        '║' +
        ANSI.reset,
    );
    process.stdout.write(
      ANSI.moveTo(1, 4) +
        ANSI.bold +
        ANSI.cyan +
        '╚════════════════════════════════════════════════════════════╝' +
        ANSI.reset,
    );

    // Draw buttons
    this.drawButtons();

    // Draw instructions
    const instructionsY = 12;
    process.stdout.write(ANSI.moveTo(1, instructionsY));
    process.stdout.write(`${ANSI.dim}Instructions:${ANSI.reset}`);
    process.stdout.write(ANSI.moveTo(1, instructionsY + 1));
    process.stdout.write('  • Move mouse over buttons to see hover effect');
    process.stdout.write(ANSI.moveTo(1, instructionsY + 2));
    process.stdout.write('  • Click buttons to interact');
    process.stdout.write(ANSI.moveTo(1, instructionsY + 3));
    process.stdout.write(`  • Press ${ANSI.bold}ESC${ANSI.reset} or ${ANSI.bold}q${ANSI.reset} to exit`);

    // Draw status bar
    this.drawStatusBar();
  }

  private drawButtons(): void {
    for (const button of this.buttons) {
      this.drawButton(button);
    }
  }

  private drawButton(button: Button): void {
    const _padding = 2;
    const totalWidth = button.width;

    // Choose background color based on state
    let bgColor = button.bgColor;
    if (button.isActive) {
      bgColor = button.activeBgColor;
    } else if (button.isHovered) {
      bgColor = button.hoverBgColor;
    }

    // Draw button top border
    process.stdout.write(ANSI.moveTo(button.x, button.y));
    process.stdout.write(`${bgColor + button.color}┌${'─'.repeat(totalWidth - 2)}┐${ANSI.reset}`);

    // Draw button content
    process.stdout.write(ANSI.moveTo(button.x, button.y + 1));
    const labelPadding = totalWidth - button.label.length - 2;
    const leftPad = Math.floor(labelPadding / 2);
    const rightPad = labelPadding - leftPad;
    process.stdout.write(
      bgColor +
        button.color +
        '│' +
        ' '.repeat(leftPad) +
        ANSI.bold +
        button.label +
        ANSI.reset +
        bgColor +
        button.color +
        ' '.repeat(rightPad) +
        '│' +
        ANSI.reset,
    );

    // Draw button bottom border
    process.stdout.write(ANSI.moveTo(button.x, button.y + 2));
    process.stdout.write(`${bgColor + button.color}└${'─'.repeat(totalWidth - 2)}┘${ANSI.reset}`);
  }

  private drawStatusBar(): void {
    const statusBarY = 18;
    const statusBarWidth = 70;

    // Draw status bar background
    process.stdout.write(ANSI.moveTo(1, statusBarY));
    process.stdout.write(ANSI.bgBrightBlack + ANSI.white + ' '.repeat(statusBarWidth) + ANSI.reset);

    // Draw status text
    const statusText = ` Status: ${this.statusMessage} | Clicks: ${this.clickCount} `;
    process.stdout.write(ANSI.moveTo(2, statusBarY));
    process.stdout.write(ANSI.bgBrightBlack + ANSI.white + ANSI.bold + statusText + ANSI.reset);
  }

  private updateStatus(message: string): void {
    this.statusMessage = message;
    this.drawStatusBar();
  }

  private setupKeyboardHandler(): void {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    process.stdin.on('keypress', (_str, key) => {
      if (key.name === 'escape' || key.name === 'q') {
        this.cleanup();
        process.exit(0);
      }
    });
  }

  private cleanup(): void {
    this.mouse.disable();
    process.stdout.write(ANSI.showCursor);
    process.stdout.write(ANSI.clearScreen);
    process.stdout.write(ANSI.moveTo(1, 1));
    console.log('Thanks for trying the Interactive Button Demo!');
  }
}

// Run the demo
const demo: InteractiveButtonDemo = new InteractiveButtonDemo();
demo.run();
