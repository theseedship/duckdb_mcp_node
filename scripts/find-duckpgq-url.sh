#!/bin/bash
# Script to help find and test DuckPGQ extension URLs for DuckDB 1.4.x
# Usage: ./scripts/find-duckpgq-url.sh [test-url]

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🔍 DuckPGQ URL Finder for DuckDB 1.4.x${NC}\n"

# Detect platform
OS=$(uname -s)
ARCH=$(uname -m)

case "$OS" in
    Linux*)
        if [ "$ARCH" = "x86_64" ]; then
            PLATFORM="linux-amd64"
        elif [ "$ARCH" = "aarch64" ]; then
            PLATFORM="linux-arm64"
        else
            PLATFORM="linux-$ARCH"
        fi
        ;;
    Darwin*)
        if [ "$ARCH" = "x86_64" ]; then
            PLATFORM="osx-amd64"
        elif [ "$ARCH" = "arm64" ]; then
            PLATFORM="osx-arm64"
        else
            PLATFORM="osx-$ARCH"
        fi
        ;;
    MINGW*|MSYS*|CYGWIN*)
        PLATFORM="windows-amd64"
        ;;
    *)
        PLATFORM="unknown"
        ;;
esac

echo -e "📍 Detected Platform: ${GREEN}$PLATFORM${NC}"
echo -e "   OS: $OS"
echo -e "   Architecture: $ARCH\n"

# Function to test URL
test_url() {
    local url=$1
    echo -e "${YELLOW}Testing URL:${NC} $url"

    # Check if URL exists with HEAD request
    HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -L "$url" 2>&1)

    if [ "$HTTP_CODE" = "200" ]; then
        echo -e "${GREEN}✅ URL is accessible (HTTP $HTTP_CODE)${NC}"

        # Get file size
        SIZE=$(curl -sI -L "$url" | grep -i content-length | tail -1 | awk '{print $2}' | tr -d '\r')
        if [ -n "$SIZE" ]; then
            SIZE_MB=$(echo "scale=2; $SIZE / 1048576" | bc)
            echo -e "   File size: ${SIZE_MB} MB"
        fi

        return 0
    else
        echo -e "${RED}❌ URL not accessible (HTTP $HTTP_CODE)${NC}"
        return 1
    fi
}

# If URL provided as argument, test it
if [ -n "$1" ]; then
    echo -e "\n${BLUE}Testing provided URL:${NC}"
    if test_url "$1"; then
        echo -e "\n${GREEN}✅ Success! Use this URL:${NC}"
        echo -e "export DUCKPGQ_CUSTOM_REPO=\"$1\""
        echo -e "\nOr add to .env:"
        echo -e "DUCKPGQ_CUSTOM_REPO=$1"
        echo -e "\nThen run:"
        echo -e "npm run test:duckpgq"
    fi
    exit 0
fi

# List of potential URLs to try
echo -e "\n${BLUE}📋 Searching for available releases...${NC}\n"

# Try to get latest releases from GitHub API
echo -e "Fetching releases from GitHub..."
RELEASES=$(curl -s "https://api.github.com/repos/cwida/duckpgq-extension/releases" 2>/dev/null || echo "[]")

# Check if we got any releases
if [ "$RELEASES" != "[]" ] && [ -n "$RELEASES" ]; then
    echo -e "${GREEN}Found releases!${NC}\n"

    # Parse releases and look for assets matching our platform
    echo "$RELEASES" | jq -r '.[] | "\(.tag_name) | \(.name) | \(.published_at)"' | head -5 | while IFS='|' read -r tag name date; do
        echo -e "${YELLOW}Release:${NC} $tag - $name"
        echo -e "   Published: $(echo $date | cut -d'T' -f1)"

        # Get assets for this release
        ASSETS=$(echo "$RELEASES" | jq -r ".[] | select(.tag_name == \"$tag\") | .assets[] | select(.name | contains(\"$PLATFORM\")) | .browser_download_url")

        if [ -n "$ASSETS" ]; then
            echo "$ASSETS" | while read -r asset_url; do
                echo -e "   ${GREEN}Found:${NC} $asset_url"
                if test_url "$asset_url"; then
                    echo -e "\n   ${GREEN}✅ This URL works! Add to .env:${NC}"
                    echo -e "   DUCKPGQ_CUSTOM_REPO=$asset_url"
                fi
            done
        else
            echo -e "   ${RED}No assets found for platform: $PLATFORM${NC}"
        fi
        echo ""
    done
else
    echo -e "${YELLOW}⚠️  Could not fetch releases from GitHub API${NC}"
    echo -e "   Possible reasons:"
    echo -e "   - Rate limit reached"
    echo -e "   - Network issue"
    echo -e "   - Repository not accessible\n"
fi

# Manual instructions
echo -e "${BLUE}📖 Manual Instructions:${NC}\n"
echo -e "1. Visit: ${YELLOW}https://github.com/cwida/duckpgq-extension/releases${NC}"
echo -e "2. Find a release compatible with DuckDB 1.4.x"
echo -e "3. Download the file for platform: ${GREEN}$PLATFORM${NC}"
echo -e "4. Look for files ending in: ${GREEN}.duckdb_extension.gz${NC}"
echo -e "5. Copy the download URL and test it:\n"
echo -e "   ${YELLOW}./scripts/find-duckpgq-url.sh \"<url>\"${NC}\n"

echo -e "${BLUE}Example URL patterns:${NC}"
echo -e "https://github.com/cwida/duckpgq-extension/releases/download/v0.1.0/duckpgq-v0.1.0-$PLATFORM.duckdb_extension.gz"
echo -e "https://github.com/cwida/duckpgq-extension/releases/download/v0.2.0/duckpgq-v0.2.0-$PLATFORM.duckdb_extension.gz"

echo -e "\n${BLUE}Alternative: GitHub Actions Artifacts${NC}"
echo -e "Visit: ${YELLOW}https://github.com/cwida/duckpgq-extension/actions${NC}"
echo -e "Look for successful builds and download artifacts (requires GitHub login)\n"

echo -e "${BLUE}Need Help?${NC}"
echo -e "- Issue #276: ${YELLOW}https://github.com/cwida/duckpgq-extension/issues/276${NC}"
echo -e "- Documentation: ${YELLOW}./FINDING_DUCKPGQ_1.4.md${NC}"
