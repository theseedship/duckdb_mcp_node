# Contributing to DuckDB MCP Native

Thank you for your interest in contributing to DuckDB MCP Native! We welcome contributions from the community.

## Getting Started

1. Fork the repository
2. Clone your fork: `git clone https://github.com/YOUR_USERNAME/duckdb-mcp-native.git`
3. Install dependencies: `npm install`
4. Create a feature branch: `git checkout -b feat/your-feature-name`

## Development Workflow

### Prerequisites

- Node.js >= 18.0.0 (use `.nvmrc` with nvm)
- npm >= 9.0.0

### Setup

```bash
# Install dependencies
npm install

# Run in development mode
npm run dev:server

# Run tests
npm test

# Check code quality
npm run check:all
```

## Code Style

We use automated tools to maintain code quality:

- **ESLint** for linting
- **Prettier** for formatting
- **TypeScript** for type checking

Before committing, run:

```bash
npm run check:all
```

## Commit Messages

We follow [Conventional Commits](https://www.conventionalcommits.org/):

- `feat:` New feature
- `fix:` Bug fix
- `docs:` Documentation changes
- `style:` Code style changes (formatting, etc.)
- `refactor:` Code refactoring
- `perf:` Performance improvements
- `test:` Test additions or changes
- `chore:` Maintenance tasks
- `build:` Build system changes
- `ci:` CI/CD changes

Examples:

```bash
git commit -m "feat: add support for WebSocket transport"
git commit -m "fix: handle null values in query results"
git commit -m "docs: update API documentation"
```

## Testing

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Writing Tests

- Place test files next to the code they test
- Use `.test.ts` suffix
- Aim for >80% code coverage

Example test structure:

```typescript
describe('DuckDBService', () => {
  it('should execute queries', async () => {
    // Test implementation
  })
})
```

## Pull Request Process

1. Ensure all tests pass: `npm test`
2. Update documentation if needed
3. Follow the PR template
4. Request review from maintainers
5. Address review feedback

### PR Checklist

- [ ] Tests pass locally
- [ ] Code follows project style
- [ ] Commit messages follow conventions
- [ ] Documentation updated
- [ ] No console.log statements
- [ ] No commented-out code

## Project Structure

```
src/
├── protocol/     # MCP protocol implementation
├── server/       # MCP server
├── client/       # MCP client
├── duckdb/       # DuckDB integration
└── types/        # TypeScript types
```

## Development Tips

### Testing with MCP Inspector

```bash
npm run inspector
```

### Debugging

1. Use VSCode debugger with provided launch configurations
2. Add breakpoints in TypeScript files
3. Check logs in `logs/` directory

### Performance

- Use streaming for large datasets
- Implement connection pooling
- Cache frequently accessed data
- Profile with Node.js built-in profiler

## Reporting Issues

Use GitHub Issues to report bugs:

1. Search existing issues first
2. Use issue templates
3. Include:
   - Node.js version
   - OS and version
   - Minimal reproduction steps
   - Error messages/stack traces

## Feature Requests

1. Open a discussion first
2. Describe use case clearly
3. Consider implementation approach
4. Be open to feedback

## Code of Conduct

### Our Pledge

We are committed to providing a friendly, safe, and welcoming environment for all contributors.

### Expected Behavior

- Be respectful and inclusive
- Welcome newcomers
- Accept constructive criticism
- Focus on what's best for the project

### Unacceptable Behavior

- Harassment or discrimination
- Personal attacks
- Trolling or insulting comments
- Public or private harassment

## Questions?

- Open a GitHub Discussion
- Check existing documentation
- Review closed issues/PRs

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

Contributors will be recognized in:

- GitHub contributors page
- Release notes
- README acknowledgments

Thank you for contributing! 🚀
