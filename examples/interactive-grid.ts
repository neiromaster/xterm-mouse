/**
 * Interactive Grid Demo
 *
 * Demonstrates clickable grid areas with visual feedback.
 * Features:
 * - Grid of clickable cells
 * - Click to toggle cell state
 * - Drag to paint multiple cells
 * - Color palette selection
 * - Visual feedback on hover and click
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
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
  bgBrightRed: '\x1b[101m',
  bgBrightGreen: '\x1b[102m',
  bgBrightYellow: '\x1b[103m',
  bgBrightBlue: '\x1b[104m',
  bgBrightBlack: '\x1b[100m',
} as const;

type CellColor = 'empty' | 'red' | 'green' | 'yellow' | 'blue' | 'magenta' | 'cyan' | 'white';

type Cell = {
  x: number;
  y: number;
  gridX: number;
  gridY: number;
  color: CellColor;
  isHovered: boolean;
};

type ColorButton = {
  label: string;
  color: CellColor;
  ansiColor: string;
  bgAnsiColor: string;
  x: number;
  y: number;
};

class InteractiveGridDemo {
  private mouse: Mouse;
  private cells: Cell[][] = [];
  private gridWidth = 16;
  private gridHeight = 10;
  private gridStartX = 5;
  private gridStartY = 6;
  private cellWidth = 4;
  private cellHeight = 3;
  private selectedColor: CellColor = 'blue';
  private isDragging = false;
  private paintedCount = 0;

  private colorButtons: ColorButton[] = [];

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
    this.initGrid();
    this.initColorButtons();
    this.drawUI();
    this.setupEventHandlers();
    this.setupKeyboardHandler();

    // biome-ignore lint/security/noSecrets: Demo application with no actual secrets
    console.log('\nInteractive Grid Demo - Click and drag to paint, Press ESC or q to exit\n');
  }

  private initGrid(): void {
    this.cells = [];
    for (let gy = 0; gy < this.gridHeight; gy++) {
      const row: Cell[] = [];
      for (let gx = 0; gx < this.gridWidth; gx++) {
        row.push({
          x: this.gridStartX + gx * this.cellWidth,
          y: this.gridStartY + gy * this.cellHeight,
          gridX: gx,
          gridY: gy,
          color: 'empty',
          isHovered: false,
        });
      }
      this.cells.push(row);
    }
  }

  private initColorButtons(): void {
    const buttons: Omit<ColorButton, 'x' | 'y'>[] = [
      { label: 'X', color: 'empty', ansiColor: ANSI.dim + ANSI.white, bgAnsiColor: ANSI.bgBrightBlack },
      { label: 'R', color: 'red', ansiColor: ANSI.bold + ANSI.white, bgAnsiColor: ANSI.bgRed },
      { label: 'G', color: 'green', ansiColor: ANSI.bold + ANSI.white, bgAnsiColor: ANSI.bgGreen },
      { label: 'Y', color: 'yellow', ansiColor: ANSI.bold + ANSI.black, bgAnsiColor: ANSI.bgYellow },
      { label: 'B', color: 'blue', ansiColor: ANSI.bold + ANSI.white, bgAnsiColor: ANSI.bgBlue },
      { label: 'M', color: 'magenta', ansiColor: ANSI.bold + ANSI.white, bgAnsiColor: ANSI.bgMagenta },
      { label: 'C', color: 'cyan', ansiColor: ANSI.bold + ANSI.black, bgAnsiColor: ANSI.bgCyan },
      { label: 'W', color: 'white', ansiColor: ANSI.bold + ANSI.black, bgAnsiColor: ANSI.bgWhite },
    ];

    const startX = 75;
    const startY = 6;

    this.colorButtons = buttons.map((btn, i) => ({
      ...btn,
      x: startX,
      y: startY + i * 3,
    }));
  }

  private setupEventHandlers(): void {
    this.mouse.on('move', (event) => {
      let needsRedraw = false;

      // Check grid cells
      for (const row of this.cells) {
        for (const cell of row) {
          const wasHovered = cell.isHovered;
          cell.isHovered = this.isInsideCell(event.x, event.y, cell);

          if (cell.isHovered !== wasHovered) {
            needsRedraw = true;
          }
        }
      }

      if (needsRedraw) {
        this.drawGrid();
      }
    });

    this.mouse.on('press', (event) => {
      this.isDragging = true;

      // Check color buttons
      for (const btn of this.colorButtons) {
        if (this.isInsideColorButton(event.x, event.y, btn)) {
          this.selectedColor = btn.color;
          this.drawColorButtons();
          this.updateStatus(`Selected color: ${btn.color.toUpperCase()}`);
          return;
        }
      }

      // Check grid cells
      for (const row of this.cells) {
        for (const cell of row) {
          if (this.isInsideCell(event.x, event.y, cell)) {
            this.paintCell(cell);
            return;
          }
        }
      }
    });

    this.mouse.on('drag', (event) => {
      if (!this.isDragging) return;

      for (const row of this.cells) {
        for (const cell of row) {
          if (this.isInsideCell(event.x, event.y, cell)) {
            this.paintCell(cell);
          }
        }
      }
    });

    this.mouse.on('release', () => {
      this.isDragging = false;
    });
  }

  private isInsideCell(x: number, y: number, cell: Cell): boolean {
    return x >= cell.x && x < cell.x + this.cellWidth && y >= cell.y && y < cell.y + this.cellHeight;
  }

  private isInsideColorButton(x: number, y: number, btn: ColorButton): boolean {
    return x >= btn.x && x < btn.x + 3 && y >= btn.y && y < btn.y + 2;
  }

  private paintCell(cell: Cell): void {
    const wasEmpty = cell.color === 'empty';
    cell.color = this.selectedColor;
    this.drawCell(cell);

    if (wasEmpty && this.selectedColor !== 'empty') {
      this.paintedCount++;
      this.updateStats();
    } else if (!wasEmpty && this.selectedColor === 'empty') {
      this.paintedCount--;
      this.updateStats();
    }
  }

  private drawUI(): void {
    process.stdout.write(ANSI.clearScreen);
    process.stdout.write(ANSI.moveTo(1, 1));

    // Draw title
    this.drawTitle();

    // Draw grid
    this.drawGrid();

    // Draw color palette
    this.drawColorButtons();

    // Draw stats
    this.drawStats();

    // Draw instructions
    this.drawInstructions();
  }

  private drawTitle(): void {
    process.stdout.write(
      ANSI.moveTo(1, 2) +
        ANSI.bold +
        ANSI.cyan +
        '╔══════════════════════════════════════════════════════════════════════════════╗' +
        ANSI.reset,
    );
    process.stdout.write(
      ANSI.moveTo(1, 3) +
        ANSI.bold +
        ANSI.cyan +
        '║' +
        ANSI.reset +
        '                    ' +
        ANSI.bold +
        '🎨 Interactive Grid Demo' +
        ANSI.reset +
        '                                  ' +
        ANSI.bold +
        ANSI.cyan +
        '║' +
        ANSI.reset,
    );
    process.stdout.write(
      ANSI.moveTo(1, 4) +
        ANSI.bold +
        ANSI.cyan +
        '╚══════════════════════════════════════════════════════════════════════════════╝' +
        ANSI.reset,
    );
  }

  private drawGrid(): void {
    for (const row of this.cells) {
      for (const cell of row) {
        this.drawCell(cell);
      }
    }

    // Draw grid border
    const borderX = this.gridStartX - 1;
    const borderY = this.gridStartY - 1;
    const gridPixelWidth = this.gridWidth * this.cellWidth;
    const gridPixelHeight = this.gridHeight * this.cellHeight;

    // Top border
    process.stdout.write(`${ANSI.moveTo(borderX, borderY) + ANSI.blue}┌${'─'.repeat(gridPixelWidth)}┐${ANSI.reset}`);

    // Left and right borders
    for (let i = 0; i < gridPixelHeight; i++) {
      process.stdout.write(`${ANSI.moveTo(borderX, borderY + 1 + i) + ANSI.blue}│${ANSI.reset}`);
      process.stdout.write(`${ANSI.moveTo(borderX + gridPixelWidth + 1, borderY + 1 + i) + ANSI.blue}│${ANSI.reset}`);
    }

    // Bottom border
    process.stdout.write(
      `${ANSI.moveTo(borderX, borderY + gridPixelHeight + 1) + ANSI.blue}└${'─'.repeat(gridPixelWidth)}┘${ANSI.reset}`,
    );
  }

  private drawCell(cell: Cell): void {
    const colorMap: Record<CellColor, string> = {
      empty: ANSI.bgBrightBlack,
      red: ANSI.bgRed,
      green: ANSI.bgGreen,
      yellow: ANSI.bgYellow,
      blue: ANSI.bgBlue,
      magenta: ANSI.bgMagenta,
      cyan: ANSI.bgCyan,
      white: ANSI.bgWhite,
    };

    const fgColorMap: Record<CellColor, string> = {
      empty: ANSI.dim + ANSI.white,
      red: ANSI.bold + ANSI.white,
      green: ANSI.bold + ANSI.white,
      yellow: ANSI.bold + ANSI.black,
      blue: ANSI.bold + ANSI.white,
      magenta: ANSI.bold + ANSI.white,
      cyan: ANSI.bold + ANSI.black,
      white: ANSI.bold + ANSI.black,
    };

    let bgColor = colorMap[cell.color];
    let fgColor = fgColorMap[cell.color];

    if (cell.isHovered && cell.color === 'empty') {
      bgColor = ANSI.bgBrightBlack;
      fgColor = ANSI.bold + ANSI.cyan;
    }

    // Draw cell top
    process.stdout.write(
      `${ANSI.moveTo(cell.x, cell.y) + bgColor + fgColor}┌${'─'.repeat(this.cellWidth - 2)}┐${ANSI.reset}`,
    );

    // Draw cell middle
    const middleText = (cell.color === 'empty' ? '·' : '█').repeat(this.cellWidth - 2);
    process.stdout.write(`${ANSI.moveTo(cell.x, cell.y + 1) + bgColor + fgColor}│${middleText}│${ANSI.reset}`);

    // Draw cell bottom
    process.stdout.write(
      `${ANSI.moveTo(cell.x, cell.y + 2) + bgColor + fgColor}└${'─'.repeat(this.cellWidth - 2)}┘${ANSI.reset}`,
    );
  }

  private drawColorButtons(): void {
    // Draw palette label
    process.stdout.write(`${ANSI.moveTo(75, 5) + ANSI.bold + ANSI.yellow}Palette:${ANSI.reset}`);

    for (const btn of this.colorButtons) {
      const isSelected = this.selectedColor === btn.color;
      const indicator = isSelected ? '►' : ' ';

      process.stdout.write(
        `${ANSI.moveTo(btn.x, btn.y) + btn.bgAnsiColor + btn.ansiColor} ${indicator} ${btn.label} ${ANSI.reset}`,
      );
    }
  }

  private drawStats(): void {
    const statsY = 38;
    process.stdout.write(
      `${ANSI.moveTo(5, statsY) + ANSI.bold + ANSI.white}Painted: ${this.paintedCount} cells${ANSI.reset}`,
    );
    process.stdout.write(
      `${ANSI.moveTo(5, statsY + 1) + ANSI.dim + ANSI.white}Grid: ${this.gridWidth} × ${this.gridHeight}${ANSI.reset}`,
    );
  }

  private updateStats(): void {
    this.drawStats();
  }

  private updateStatus(message: string): void {
    const statusY = 40;
    const clearLength = 80;
    process.stdout.write(ANSI.moveTo(5, statusY));
    process.stdout.write(' '.repeat(clearLength));
    process.stdout.write(ANSI.moveTo(5, statusY));
    process.stdout.write(ANSI.bold + ANSI.cyan + message + ANSI.reset);
  }

  private drawInstructions(): void {
    const instructionsY = 42;

    process.stdout.write(`${ANSI.moveTo(5, instructionsY) + ANSI.dim}Controls:${ANSI.reset}`);
    process.stdout.write(`${ANSI.moveTo(5, instructionsY + 1)}  • Click cells to paint them with selected color`);
    process.stdout.write(`${ANSI.moveTo(5, instructionsY + 2)}  • Drag to paint multiple cells`);
    process.stdout.write(`${ANSI.moveTo(5, instructionsY + 3)}  • Click color buttons to change paint color`);
    process.stdout.write(
      ANSI.moveTo(5, instructionsY + 4) +
        '  • Press ' +
        ANSI.bold +
        'X' +
        ANSI.reset +
        ' or select empty color to erase',
    );
    process.stdout.write(
      ANSI.moveTo(5, instructionsY + 5) +
        '  • Press ' +
        ANSI.bold +
        'ESC' +
        ANSI.reset +
        ' or ' +
        ANSI.bold +
        'q' +
        ANSI.reset +
        ' to exit',
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
    });
  }

  private cleanup(): void {
    this.mouse.disable();
    process.stdout.write(ANSI.showCursor);
    process.stdout.write(ANSI.clearScreen);
    process.stdout.write(ANSI.moveTo(1, 1));
    console.log('Thanks for trying the Interactive Grid Demo!');
    console.log(`You painted ${this.paintedCount} cells!`);
  }
}

// Run the demo
const demo: InteractiveGridDemo = new InteractiveGridDemo();
demo.run();
