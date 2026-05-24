# Contributing to CodeSentinel

Thank you for your interest in contributing to CodeSentinel! This document provides guidelines and instructions for contributing.

## How to Contribute

1. **Fork** the repository
2. Create a **feature branch** from `main`: `git checkout -b feat/my-feature`
3. Make your changes and **commit** them with a descriptive message
4. **Push** your branch to your fork: `git push origin feat/my-feature`
5. Open a **Pull Request** against the `main` branch

### Branch Naming

Use the following prefixes for your branches:

- `feat/` — New features
- `fix/` — Bug fixes
- `docs/` — Documentation changes
- `refactor/` — Code refactoring
- `chore/` — Maintenance tasks

## Development Setup

### Prerequisites

- Node.js 20+
- npm or bun

### Steps

1. **Clone** the repository:
   ```bash
   git clone https://github.com/your-org/codesentinel.git
   cd codesentinel
   ```

2. **Install** dependencies:
   ```bash
   npm ci
   ```

3. **Set up** the database:
   ```bash
   npx prisma generate
   npm run db:push
   ```

4. **Copy** the environment template:
   ```bash
   cp .env.example .env
   ```

5. **Start** the development server:
   ```bash
   npm run dev
   ```

The app will be available at `http://localhost:3000`.

## Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch
```

Tests use [Vitest](https://vitest.dev/). Please ensure all tests pass before submitting a PR.

## Code Style

- **TypeScript**: Strict mode is enabled (`noImplicitAny`, `strict`). All code must be properly typed.
- **ESLint**: Run `npm run lint` to check for style issues. All lint warnings should be addressed.
- **Formatting**: Follow the existing code style in the repository.
- **Components**: Use shadcn/ui components from `src/components/ui/` instead of building from scratch.
- **Imports**: Use `@/` path aliases (e.g., `import { db } from '@/lib/db'`).

## Commit Message Format

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <description>

[optional body]

[optional footer]
```

### Types

- `feat` — New feature
- `fix` — Bug fix
- `docs` — Documentation only
- `style` — Code style changes (formatting, semicolons, etc.)
- `refactor` — Code refactoring without feature changes or fixes
- `test` — Adding or updating tests
- `chore` — Build process, tooling, or maintenance changes

### Examples

```
feat(webhook): add GitLab merge request event support
fix(auth): resolve session expiration edge case
docs(readme): update installation instructions
chore(deps): upgrade Next.js to v16
```

## PR Review Process

1. All PRs require at least one approval before merging
2. CI checks must pass (lint, typecheck, test, build)
3. PRs should be focused and reasonably sized — avoid bundling unrelated changes
4. Include a clear description of what the PR does and why
5. If your PR fixes an issue, reference it: `Fixes #123`

### Review Checklist

- [ ] Code compiles without errors (`npx tsc --noEmit`)
- [ ] Lint passes (`npm run lint`)
- [ ] Tests pass (`npm test`)
- [ ] New features include tests
- [ ] No unnecessary dependencies added
- [ ] UI changes are responsive and accessible

## Reporting Issues

When reporting a bug or requesting a feature, please use the GitHub Issues tab and include:

- **Bug reports**: Steps to reproduce, expected behavior, actual behavior, and environment details (OS, Node version, browser)
- **Feature requests**: Clear description of the problem you're solving and your proposed solution
- **Security vulnerabilities**: Please report privately via email rather than a public issue

---

Thank you for helping make CodeSentinel better!
