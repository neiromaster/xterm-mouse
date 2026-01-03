# Contributing to xterm-mouse

Thank you for your interest in contributing to xterm-mouse! This document provides guidelines and instructions for contributing to the project.

## Development Setup

### Prerequisites

* **Bun**: This project uses Bun as its runtime and package manager. Install it from [bun.sh](https://bun.sh/).
* **Git**: For version control.

### Cloning the Repository

```bash
git clone https://github.com/neiropacks/xterm-mouse.git
cd xterm-mouse
```

### Installing Dependencies

```bash
bun install
```

### Building the Project

```bash
bun run build
```

This compiles the TypeScript code into the `dist/` directory and generates type declaration files.

## Project Structure

```
xterm-mouse/
├── src/
│   ├── core/
│   │   ├── Mouse.ts          # Main Mouse class implementation
│   │   └── Mouse.test.ts     # Tests for Mouse class
│   ├── parser/
│   │   ├── ansiParser.ts     # ANSI escape sequence parser
│   │   ├── ansiParser.test.ts
│   │   └── constants.ts      # Parser constants
│   ├── types/
│   │   └── index.ts          # TypeScript type definitions
│   └── index.ts              # Main entry point
├── examples/
│   ├── basic.ts              # Basic usage example
│   └── streaming.ts          # Streaming API example
├── package.json
├── tsup.config.ts            # Build configuration
└── tsconfig.json             # TypeScript configuration
```

## Development Workflow

### Running Examples

The project includes examples that demonstrate the library's usage:

```bash
# Run the basic example with hot-reloading
bun run dev:basic

# Run the streaming example with hot-reloading
bun run dev:streaming
```

> [!NOTE]
> The examples use `--watch` mode, so any changes you make will automatically restart the example.

### Running Tests

```bash
# Run all tests
bun test

# Run tests with coverage
bun run coverage
```

### Type Checking

```bash
bun run typecheck
```

This runs TypeScript compiler to check for type errors without emitting files.

## Code Style

This project uses:

* **Biome**: For fast linting and formatting.
* **dprint**: For additional code formatting.

### Checking Code Style

```bash
bun run lint
```

### Formatting Code

```bash
bun run format
```

This automatically formats your code according to the project's style guide.

### Pre-commit Hooks

The project uses lefthook to run pre-commit checks. These are automatically installed when you run `bun install`. The hooks ensure that:

* Code is properly formatted
* Linting passes
* Tests pass

> [!CAUTION]
> If you need to bypass pre-commit hooks (not recommended), use `git commit --no-verify`.

## Making Changes

### Branch Naming

Use descriptive branch names:

* `feature/` for new features (e.g., `feature/add-wheel-support`)
* `fix/` for bug fixes (e.g., `fix/coordinate-parsing`)
* `docs/` for documentation updates (e.g., `docs/update-readme`)
* `refactor/` for code refactoring (e.g., `refactor/parser-architecture`)

### Commit Messages

Write clear, descriptive commit messages:

```
feat: add support for horizontal wheel scrolling

fix: correct coordinate calculation in SGR mode

docs: update API documentation for stream() method

refactor: simplify event queue management
```

Follow the [Conventional Commits](https://www.conventionalcommits.org/) specification:

* `feat:` for new features
* `fix:` for bug fixes
* `docs:` for documentation changes
* `refactor:` for code refactoring
* `test:` for adding or updating tests
* `chore:` for maintenance tasks

### Pull Request Process

1. **Fork the repository** and create your branch from `main`.
2. **Make your changes** following the code style guidelines.
3. **Test your changes**:

    ```bash
    bun test
    bun run typecheck
    bun run lint
    ```

4. **Update documentation** if your changes affect the API or usage.
5. **Commit your changes** with a clear commit message.
6. **Push to your fork** and create a pull request.

### Pull Request Guidelines

* Provide a clear description of the changes and why they're necessary.
* Link related issues using `#issue-number`.
* Ensure all CI checks pass.
* Keep changes focused and minimal.
* Update tests to cover new functionality.

## Testing

### Writing Tests

Tests should be placed alongside the source files they test with a `.test.ts` suffix:

```
src/core/Mouse.ts          →  src/core/Mouse.test.ts
src/parser/ansiParser.ts   →  src/parser/ansiParser.test.ts
```

### Test Structure

```typescript
import { test, expect } from "bun:test";

test("descriptive test name", () => {
  // Arrange
  const input = /* test input */;

  // Act
  const result = /* function call */;

  // Assert
  expect(result).toBe(/* expected value */);
});
```

## Documentation

* Keep documentation in sync with code changes.
* Use clear examples in code comments.
* Update README.md if you add new features or change the API.
* Follow the existing documentation style in README.md.

## Getting Help

* **GitHub Issues**: Use [GitHub Issues](https://github.com/neiropacks/xterm-mouse/issues) for bug reports and feature requests.
* **Discussions**: Use GitHub Discussions for questions and general topics.

## Code of Conduct

Be respectful, inclusive, and constructive. We aim to maintain a welcoming community for all contributors.

## License

By contributing to xterm-mouse, you agree that your contributions will be licensed under the same license as the project.
