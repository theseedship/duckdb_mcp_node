#!/bin/bash

# Fix console statements in all TypeScript files
# This script replaces console.* with logger.* and adds imports

echo "🔧 Starting console.* to logger.* replacement..."

# List of files to fix (excluding test files and the logger itself)
FILES=$(find src -name "*.ts" -type f ! -name "*.test.ts" ! -name "*.spec.ts" ! -name "logger.ts" | sort)

# Counter for tracking progress
TOTAL=0
FIXED=0

for file in $FILES; do
    TOTAL=$((TOTAL + 1))

    # Check if file has any console statements
    if grep -q "console\.\(log\|info\|warn\|error\|debug\)" "$file"; then
        echo "  📝 Fixing: $file"
        FIXED=$((FIXED + 1))

        # Create backup
        cp "$file" "${file}.backup"

        # Check if logger import already exists
        if ! grep -q "import.*logger.*from.*utils/logger" "$file"; then
            # Find the last import line
            LAST_IMPORT=$(grep -n "^import " "$file" | tail -1 | cut -d: -f1)

            if [ -n "$LAST_IMPORT" ]; then
                # Add logger import after the last import
                sed -i "${LAST_IMPORT}a\\import { logger } from '../utils/logger.js'" "$file"
                echo "    ✅ Added logger import"
            else
                # No imports found, add at the beginning (after shebang if present)
                if head -1 "$file" | grep -q "^#!"; then
                    sed -i "2i\\import { logger } from '../utils/logger.js'\\n" "$file"
                else
                    sed -i "1i\\import { logger } from '../utils/logger.js'\\n" "$file"
                fi
                echo "    ✅ Added logger import at top"
            fi
        fi

        # Replace console.log/info/warn/error/debug with logger.*
        sed -i 's/console\.log(/logger.log(/g' "$file"
        sed -i 's/console\.info(/logger.info(/g' "$file"
        sed -i 's/console\.warn(/logger.warn(/g' "$file"
        sed -i 's/console\.error(/logger.error(/g' "$file"
        sed -i 's/console\.debug(/logger.debug(/g' "$file"

        # Special case: .catch(console.error) -> .catch(error => logger.error(error))
        sed -i 's/\.catch(console\.error)/\.catch(error => logger.error(error))/g' "$file"

        # Fix the import path based on file depth
        # Count directory depth to adjust relative path
        DEPTH=$(echo "$file" | tr '/' '\n' | grep -c ".")
        IMPORT_PATH="../utils/logger.js"

        if [[ "$file" == "src/utils/"* ]]; then
            IMPORT_PATH="./logger.js"
        elif [[ "$file" == "src/"*"/"* ]]; then
            # Two levels deep (e.g., src/client/*)
            IMPORT_PATH="../utils/logger.js"
        elif [[ "$file" == "src/"*"/"*"/"* ]]; then
            # Three levels deep
            IMPORT_PATH="../../utils/logger.js"
        fi

        # Fix the import path
        sed -i "s|from '\.\./utils/logger\.js'|from '$IMPORT_PATH'|" "$file"

        # Count replacements
        REPLACEMENTS=$(grep -c "logger\.\(log\|info\|warn\|error\|debug\)" "$file")
        echo "    ✅ Replaced $REPLACEMENTS console statements"

        # Remove backup if successful
        rm "${file}.backup"
    fi
done

echo ""
echo "✨ Console replacement complete!"
echo "📊 Stats: Fixed $FIXED out of $TOTAL files"
echo ""

# List remaining console statements in non-test files (should be none)
echo "🔍 Checking for remaining console statements..."
REMAINING=$(grep -r "console\.\(log\|info\|warn\|error\|debug\)" src --include="*.ts" --exclude="*.test.ts" --exclude="*.spec.ts" --exclude="logger.ts" | wc -l)

if [ "$REMAINING" -eq 0 ]; then
    echo "✅ All console statements have been replaced!"
else
    echo "⚠️  Found $REMAINING remaining console statements:"
    grep -r "console\.\(log\|info\|warn\|error\|debug\)" src --include="*.ts" --exclude="*.test.ts" --exclude="*.spec.ts" --exclude="logger.ts" | head -5
fi