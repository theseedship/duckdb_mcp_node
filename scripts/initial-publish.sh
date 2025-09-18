#!/bin/bash

# Initial NPM Publish Script
# This script helps with the first-time publish to npm

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Initial NPM Publish Script${NC}"
echo "================================"

# Check if NPM_TOKEN is set
if [ -z "$NPM_TOKEN" ]; then
  echo -e "${RED}❌ NPM_TOKEN environment variable not set${NC}"
  echo ""
  echo "To set your token:"
  echo "1. Create a token at: https://www.npmjs.com/settings/~/tokens"
  echo "2. Choose 'Granular Access Token' or 'Classic Token (Publish)'"
  echo "3. Run: export NPM_TOKEN='your-token-here'"
  echo ""
  exit 1
fi

# Check current version
CURRENT_VERSION=$(node -p "require('./package.json').version")
PACKAGE_NAME=$(node -p "require('./package.json').name")

echo -e "📦 Package: ${YELLOW}$PACKAGE_NAME${NC}"
echo -e "📌 Version: ${YELLOW}$CURRENT_VERSION${NC}"
echo ""

# Check if already published
echo "Checking if version already published..."
if npm view "$PACKAGE_NAME@$CURRENT_VERSION" > /dev/null 2>&1; then
  echo -e "${YELLOW}⚠️  Version $CURRENT_VERSION already published${NC}"
  echo ""
  echo "Options:"
  echo "1. Bump version: npm version patch"
  echo "2. Force republish with different version"
  exit 1
fi

# Build the project
echo -e "${GREEN}📨 Building project...${NC}"
npm run build

# Set npm auth token
echo -e "${GREEN}🔑 Setting npm authentication...${NC}"
echo "//registry.npmjs.org/:_authToken=${NPM_TOKEN}" > ~/.npmrc

# Verify authentication
echo "Verifying npm authentication..."
NPM_USER=$(npm whoami 2>/dev/null || echo "")
if [ -z "$NPM_USER" ]; then
  echo -e "${RED}❌ Authentication failed. Please check your NPM_TOKEN${NC}"
  rm ~/.npmrc
  exit 1
fi
echo -e "${GREEN}✅ Authenticated as: $NPM_USER${NC}"

# Dry run first
echo ""
echo -e "${YELLOW}📋 Performing dry run...${NC}"
npm publish --dry-run --access public

# Ask for confirmation
echo ""
echo -e "${YELLOW}Ready to publish to npm?${NC}"
read -p "Type 'yes' to continue: " -r
if [[ ! $REPLY =~ ^[Yy]es$ ]]; then
  echo "Publishing cancelled"
  rm ~/.npmrc
  exit 1
fi

# Actual publish
echo ""
echo -e "${GREEN}🚀 Publishing to npm...${NC}"
npm publish --access public

# Clean up
rm ~/.npmrc

echo ""
echo -e "${GREEN}✅ Successfully published $PACKAGE_NAME@$CURRENT_VERSION to npm!${NC}"
echo ""
echo "Install with:"
echo "  npm install $PACKAGE_NAME@$CURRENT_VERSION"
echo ""
echo "View on npm:"
echo "  https://www.npmjs.com/package/$PACKAGE_NAME"