/**
 * Interactive Menu Demo
 *
 * Demonstrates a menu with hover effects and selection using mouse events.
 * Features:
 * - Menu items with hover highlight
 * - Click to select
 * - Visual feedback on selection
 * - Description panel showing item details
 * - Keyboard navigation support
 */

import readline from 'node:readline';
import { Mouse, MouseError } from '../src';

// ANSI Escape Codes
const ANSI = {
  clearScreen: '\x1b[2J',
  moveTo: (x: number, y: number) => `\x1b[${y};${x}H`,
  hideCursor: '\x1b[?25l',
  showCursor: '\x1b[?25h',
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  white: '\x1b[37m',
  black: '\x1b[30m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  bgWhite: '\x1b[47m',
  bgBlue: '\x1b[44m',
  bgBrightBlue: '\x1b[104m',
  bgCyan: '\x1b[46m',
  bgBrightCyan: '\x1b[106m',
  bgBlack: '\x1b[40m',
  bgBrightBlack: '\x1b[100m',
} as const;

type MenuItem = {
  id: string;
  label: string;
  description: string;
  icon: string;
  y: number;
  x: number;
  width: number;
};

class InteractiveMenuDemo {
  private mouse: Mouse;
  private menuItems: MenuItem[] = [];
  private selectedItem: MenuItem | null = null;
  private hoveredItem: MenuItem | null = null;
  private selectedIndex = -1;

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

    process.stdout.write(ANSI.hideCursor);
    this.initMenu();
    this.drawUI();
    this.setupEventHandlers();
    this.setupKeyboardHandler();

    // biome-ignore lint/security/noSecrets: Demo application with no actual secrets
    console.log('\nInteractive Menu Demo - Use mouse or arrow keys, Press ESC or q to exit\n');
  }

  private initMenu(): void {
    const startX = 10;
    const startY = 6;
    const itemWidth = 30;
    const itemHeight = 1;

    this.menuItems = [
      {
        id: 'new-file',
        label: 'New File',
        description: 'Create a new file in the current directory',
        icon: '📄',
        y: startY,
        x: startX,
        width: itemWidth,
      },
      {
        id: 'open-file',
        label: 'Open File',
        description: 'Open an existing file from the file system',
        icon: '📂',
        y: startY + itemHeight + 1,
        x: startX,
        width: itemWidth,
      },
      {
        id: 'save',
        label: 'Save',
        description: 'Save the current file to disk',
        icon: '💾',
        y: startY + (itemHeight + 1) * 2,
        x: startX,
        width: itemWidth,
      },
      {
        id: 'settings',
        label: 'Settings',
        description: 'Configure application preferences and options',
        icon: '⚙️',
        y: startY + (itemHeight + 1) * 3,
        x: startX,
        width: itemWidth,
      },
      {
        id: 'help',
        label: 'Help',
        description: 'View documentation and get help',
        icon: '❓',
        y: startY + (itemHeight + 1) * 4,
        x: startX,
        width: itemWidth,
      },
      {
        id: 'exit',
        label: 'Exit',
        description: 'Close the application',
        icon: '🚪',
        y: startY + (itemHeight + 1) * 5,
        x: startX,
        width: itemWidth,
      },
    ];
  }

  private setupEventHandlers(): void {
    this.mouse.on('move', (event) => {
      const prevHovered = this.hoveredItem;
      this.hoveredItem = this.getMenuItemAt(event.x, event.y);

      if (prevHovered !== this.hoveredItem) {
        this.drawMenu();
        if (this.hoveredItem) {
          this.drawDescription(this.hoveredItem);
        } else if (this.selectedItem) {
          this.drawDescription(this.selectedItem);
        } else {
          this.drawDescription(null);
        }
      }
    });

    this.mouse.on('click', (event) => {
      const item = this.getMenuItemAt(event.x, event.y);
      if (item) {
        this.selectItem(item);
      }
    });
  }

  private getMenuItemAt(x: number, y: number): MenuItem | null {
    for (const item of this.menuItems) {
      if (x >= item.x && x < item.x + item.width && y === item.y) {
        return item;
      }
    }
    return null;
  }

  private selectItem(item: MenuItem): void {
    this.selectedItem = item;
    this.selectedIndex = this.menuItems.indexOf(item);
    this.drawMenu();
    this.drawDescription(item);
    this.drawActionFeedback(item);
  }

  private drawActionFeedback(item: MenuItem): void {
    const feedbackY = 17;
    const message = `✓ Selected: ${item.icon} ${item.label}`;

    process.stdout.write(ANSI.moveTo(10, feedbackY));
    process.stdout.write(ANSI.green + ANSI.bold + message + ANSI.reset);

    // Clear feedback after 2 seconds
    setTimeout(() => {
      process.stdout.write(ANSI.moveTo(10, feedbackY));
      process.stdout.write(' '.repeat(message.length));
    }, 2000);
  }

  private drawUI(): void {
    process.stdout.write(ANSI.clearScreen);
    process.stdout.write(ANSI.moveTo(1, 1));

    // Draw header
    this.drawHeader();

    // Draw menu
    this.drawMenu();

    // Draw description panel
    this.drawDescriptionPanel();

    // Draw instructions
    this.drawInstructions();
  }

  private drawHeader(): void {
    process.stdout.write(
      `${ANSI.moveTo(1, 2) + ANSI.bold + ANSI.cyan}┌─────────────────────────────────────────────────────────────────┐${ANSI.reset}`,
    );
    process.stdout.write(
      `${ANSI.moveTo(1, 3) + ANSI.bold + ANSI.cyan}│${ANSI.reset}              ${ANSI.bold}📋 Interactive Menu Demo${ANSI.reset}                           ${ANSI.bold}${ANSI.cyan}│${ANSI.reset}`,
    );
    process.stdout.write(
      `${ANSI.moveTo(1, 4) + ANSI.bold + ANSI.cyan}└─────────────────────────────────────────────────────────────────┘${ANSI.reset}`,
    );
  }

  private drawMenu(): void {
    // Draw menu border
    const menuX = 9;
    const menuY = 5;
    const menuWidth = 34;
    const menuHeight = this.menuItems.length * 2 + 1;

    // Top border
    process.stdout.write(`${ANSI.moveTo(menuX, menuY) + ANSI.blue}┌${'─'.repeat(menuWidth - 2)}┐${ANSI.reset}`);

    // Menu items
    for (const item of this.menuItems) {
      this.drawMenuItem(item);
    }

    // Bottom border
    process.stdout.write(
      `${ANSI.moveTo(menuX, menuY + menuHeight - 1) + ANSI.blue}└${'─'.repeat(menuWidth - 2)}┘${ANSI.reset}`,
    );
  }

  private drawMenuItem(item: MenuItem): void {
    const isHovered = this.hoveredItem === item;
    const isSelected = this.selectedItem === item;

    let bgColor: string = ANSI.bgBlack;
    let textColor: string = ANSI.white;

    if (isSelected) {
      bgColor = ANSI.bgBlue;
      textColor = ANSI.bold + ANSI.white;
    } else if (isHovered) {
      bgColor = ANSI.bgBrightBlack;
      textColor = ANSI.bold + ANSI.cyan;
    }

    const line1 = `${item.icon} ${item.label}`;
    const padding = item.width - line1.length;

    // Draw the item content with background
    process.stdout.write(
      `${ANSI.moveTo(item.x - 1, item.y) + bgColor}${textColor}│ ${line1} ${' '.repeat(padding)}│${ANSI.reset}`,
    );

    // Empty line for spacing - use blue border with proper background
    process.stdout.write(
      `${ANSI.moveTo(item.x - 1, item.y + 1) + ANSI.blue + ANSI.bgBlack}│${' '.repeat(item.width + 2)}│${ANSI.reset}`,
    );
  }

  private drawDescriptionPanel(): void {
    const panelX = 50;
    const panelY = 6;
    const panelWidth = 40;
    const panelHeight = 10;

    // Panel border
    process.stdout.write(
      `${ANSI.moveTo(panelX, panelY) + ANSI.dim + ANSI.cyan}┌${'─'.repeat(panelWidth - 2)}┐${ANSI.reset}`,
    );

    for (let i = 1; i < panelHeight - 1; i++) {
      process.stdout.write(
        `${ANSI.moveTo(panelX, panelY + i) + ANSI.dim + ANSI.cyan}│${' '.repeat(panelWidth - 2)}│${ANSI.reset}`,
      );
    }

    process.stdout.write(
      `${ANSI.moveTo(panelX, panelY + panelHeight - 1) + ANSI.dim + ANSI.cyan}└${'─'.repeat(panelWidth - 2)}┘${ANSI.reset}`,
    );

    // Panel title
    process.stdout.write(`${ANSI.moveTo(panelX + 2, panelY + 1) + ANSI.bold + ANSI.yellow}Details${ANSI.reset}`);
  }

  private drawDescription(item: MenuItem | null): void {
    const panelX = 50;
    const panelY = 6;
    const panelWidth = 40;

    // Clear description area
    for (let i = 3; i < 8; i++) {
      process.stdout.write(ANSI.moveTo(panelX + 2, panelY + i) + ANSI.reset + ' '.repeat(panelWidth - 4));
    }

    if (item) {
      // Draw icon
      process.stdout.write(ANSI.moveTo(panelX + panelWidth / 2 - 1, panelY + 3) + item.icon);

      // Draw label
      const label = item.label;
      process.stdout.write(
        ANSI.moveTo(panelX + (panelWidth - label.length) / 2, panelY + 4) + ANSI.bold + ANSI.white + label + ANSI.reset,
      );

      // Draw description (word wrap)
      const description = item.description;
      const maxLineWidth = panelWidth - 4;
      const words = description.split(' ');
      const lines: string[] = [];
      let currentLine = '';

      for (const word of words) {
        if (`${currentLine} ${word}`.trim().length <= maxLineWidth) {
          currentLine = `${currentLine} ${word}`.trim();
        } else {
          if (currentLine) {
            lines.push(currentLine);
          }
          currentLine = word;
        }
      }
      if (currentLine) {
        lines.push(currentLine);
      }

      for (let i = 0; i < lines.length && i < 2; i++) {
        process.stdout.write(ANSI.moveTo(panelX + 3, panelY + 6 + i) + ANSI.dim + ANSI.white + lines[i] + ANSI.reset);
      }
    } else {
      // No selection
      const noSelection = 'Hover over or select a menu item';
      process.stdout.write(
        ANSI.moveTo(panelX + (panelWidth - noSelection.length) / 2, panelY + 5) +
          ANSI.dim +
          ANSI.white +
          noSelection +
          ANSI.reset,
      );
    }
  }

  private drawInstructions(): void {
    const instructionsY = 18;

    process.stdout.write(`${ANSI.moveTo(1, instructionsY) + ANSI.dim}Controls:${ANSI.reset}`);
    process.stdout.write(`${ANSI.moveTo(1, instructionsY + 1)}  • Move mouse to hover over menu items`);
    process.stdout.write(`${ANSI.moveTo(1, instructionsY + 2)}  • Click to select a menu item`);
    process.stdout.write(
      `${ANSI.moveTo(1, instructionsY + 3)}  • Use ${ANSI.bold}↑/↓${ANSI.reset} arrow keys for keyboard navigation`,
    );
    process.stdout.write(
      `${ANSI.moveTo(1, instructionsY + 4)}  • Press ${ANSI.bold}Enter${ANSI.reset} to select highlighted item`,
    );
    process.stdout.write(
      `${ANSI.moveTo(1, instructionsY + 5)}  • Press ${ANSI.bold}ESC${ANSI.reset} or ${ANSI.bold}q${ANSI.reset} to exit`,
    );
  }

  private setupKeyboardHandler(): void {
    readline.emitKeypressEvents(process.stdin);
    process.stdin.setRawMode(true);

    process.stdin.on('keypress', (_str, key) => {
      if (key.name === 'escape' || key.name === 'q') {
        this.cleanup();
        process.exit(0);
      }

      if (key.name === 'up') {
        this.selectedIndex = (this.selectedIndex - 1 + this.menuItems.length) % this.menuItems.length;
        this.selectItem(this.menuItems[this.selectedIndex]);
      }

      if (key.name === 'down') {
        this.selectedIndex = (this.selectedIndex + 1) % this.menuItems.length;
        this.selectItem(this.menuItems[this.selectedIndex]);
      }

      if (key.name === 'return' && this.selectedIndex >= 0) {
        this.selectItem(this.menuItems[this.selectedIndex]);
      }
    });
  }

  private cleanup(): void {
    this.mouse.disable();
    process.stdout.write(ANSI.showCursor);
    process.stdout.write(ANSI.clearScreen);
    process.stdout.write(ANSI.moveTo(1, 1));
    console.log('Thanks for trying the Interactive Menu Demo!');
  }
}

// Run the demo
const demo: InteractiveMenuDemo = new InteractiveMenuDemo();
demo.run();
