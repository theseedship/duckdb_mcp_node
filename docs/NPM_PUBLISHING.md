# NPM Publishing Guide

## 🚀 Overview

This package is published to npm as `@deposium/duckdb-mcp-native` with automatic publishing via GitHub Actions.

## 📦 Publishing Methods

### Method 1: Automatic Publishing (Recommended)

Triggers automatically when version changes in package.json on main branch.

```bash
# 1. Update version locally
npm version patch  # or minor/major

# 2. Commit and push
git add package.json package-lock.json
git commit -m "chore: bump version to x.x.x"
git push

# 3. GitHub Actions automatically:
# - Detects version change
# - Runs tests
# - Publishes to npm
# - Creates GitHub release
```

### Method 2: Manual Release with Tags

```bash
# 1. Create release with standard-version
npm run release        # patch release
npm run release:minor  # minor release
npm run release:major  # major release

# 2. Push with tags
git push --follow-tags

# 3. GitHub Actions triggered by tag
```

### Method 3: Manual Workflow Dispatch

1. Go to Actions tab on GitHub
2. Select "Release (Manual)" workflow
3. Click "Run workflow"
4. Enter version number
5. Click "Run"

## 🔑 Setup Requirements

### 1. NPM Token Setup

1. **Login to npmjs.com**
2. **Go to Account Settings → Access Tokens**
3. **Generate New Token:**
   - Type: **Automation** (survives 2FA changes)
   - Name: `github-actions-duckdb-mcp-node`
4. **Copy the token** (starts with `npm_`)

### 2. GitHub Repository Setup

1. **Go to Repository Settings → Secrets and variables → Actions**
2. **Add New Repository Secret:**
   - Name: `NPM_TOKEN`
   - Value: Your npm token

### 3. NPM Organization Setup

For `@deposium` scoped packages:

```bash
# Ensure you have publish rights
npm org ls deposium

# Add member if needed (owner only)
npm org add deposium <username> --role=developer
```

## 📋 Version Management

### Semantic Versioning

- **Patch** (x.x.1): Bug fixes
- **Minor** (x.1.0): New features (backward compatible)
- **Major** (1.0.0): Breaking changes

### Version Commands

```bash
# View current version
npm version

# Bump versions
npm version patch     # 0.1.0 → 0.1.1
npm version minor     # 0.1.1 → 0.2.0
npm version major     # 0.2.0 → 1.0.0

# Prerelease versions
npm version prerelease --preid=beta  # 1.0.0 → 1.0.1-beta.0
npm version prerelease               # 1.0.1-beta.0 → 1.0.1-beta.1
```

## 🔄 Workflow Files

### `.github/workflows/publish.yml`

- Triggers on push to main when package.json changes
- Automatically publishes if version changed
- Creates GitHub release

### `.github/workflows/release.yml`

- Triggers on git tags (v\*)
- Manual workflow dispatch option
- Full test suite before publishing

### `.github/workflows/ci.yml`

- Runs on every push/PR
- Tests, linting, type checking
- Dry-run publish on main

## 📝 Pre-Publishing Checklist

Before publishing a new version:

- [ ] All tests passing: `npm test`
- [ ] Linting clean: `npm run lint`
- [ ] Types correct: `npm run typecheck`
- [ ] Build successful: `npm run build`
- [ ] CHANGELOG updated
- [ ] README accurate
- [ ] Version bumped appropriately

## 🛠️ Troubleshooting

### "Permission denied" on npm publish

```bash
# Check authentication
npm whoami

# Re-authenticate if needed
npm login --scope=@deposium
```

### Version already exists

```bash
# Check published versions
npm view @deposium/duckdb-mcp-native versions

# Bump to next version
npm version patch
```

### GitHub Action fails

1. Check NPM_TOKEN secret is set correctly
2. Ensure token has publish permissions
3. Verify package.json publishConfig

### Testing publish locally

```bash
# Dry run (doesn't actually publish)
npm publish --dry-run

# Check what files will be published
npm pack --dry-run
```

## 📊 Package Info

```bash
# View package info
npm view @deposium/duckdb-mcp-native

# View all versions
npm view @deposium/duckdb-mcp-native versions

# View dist-tags
npm view @deposium/duckdb-mcp-native dist-tags
```

## 🏷️ Dist Tags

```bash
# Latest stable
npm install @deposium/duckdb-mcp-native@latest

# Beta versions (if available)
npm install @deposium/duckdb-mcp-native@beta

# Specific version
npm install @deposium/duckdb-mcp-native@0.1.0
```

## 🔒 Security Notes

- NPM_TOKEN should be **Automation** type
- Token stored as GitHub Secret
- Never commit tokens to repository
- Rotate tokens periodically
- Use 2FA on npm account

## 📚 References

- [npm Documentation](https://docs.npmjs.com/packages-and-modules/introduction-to-packages-and-modules)
- [GitHub Actions for npm](https://docs.github.com/en/actions/publishing-packages/publishing-nodejs-packages)
- [Semantic Versioning](https://semver.org/)
- [npm Organizations](https://docs.npmjs.com/organizations)
