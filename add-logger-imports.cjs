#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const files = [
  'src/client/ResourceMapper.ts',
  'src/protocol/tcp-transport.ts',
  'src/protocol/websocket-transport.ts',
  'src/service/DuckDBMcpNativeService.ts',
  'src/federation/ConnectionPool.ts',
  'src/utils/connection-reset.ts',
  'src/federation/QueryRouter.ts',
  'src/federation/ResourceRegistry.ts',
  'src/duckdb/service.ts',
  'src/context/SpaceContext.ts',
  'src/protocol/messages.ts',
  'src/protocol/transport.ts',
  'src/protocol/http-transport.ts'
];

files.forEach(file => {
  const filePath = path.join(__dirname, file);
  if (!fs.existsSync(filePath)) {
    console.log(`File not found: ${file}`);
    return;
  }

  let content = fs.readFileSync(filePath, 'utf8');

  // Check if file uses logger but doesn't import it
  if (content.includes('logger.') && !content.includes('import') || !content.includes('logger')) {
    // Calculate relative path to logger
    const depth = file.split('/').length - 1;
    let importPath = './logger.js';

    if (file.startsWith('src/utils/')) {
      importPath = './logger.js';
    } else if (depth === 2) {
      importPath = '../utils/logger.js';
    } else if (depth === 3) {
      importPath = '../../utils/logger.js';
    }

    // Add import at the beginning or after existing imports
    const lines = content.split('\n');
    let lastImportIndex = -1;

    for (let i = 0; i < lines.length; i++) {
      if (lines[i].startsWith('import ')) {
        lastImportIndex = i;
      }
    }

    if (lastImportIndex >= 0) {
      lines.splice(lastImportIndex + 1, 0, `import { logger } from '${importPath}'`);
    } else {
      // Add at the beginning (after shebang if present)
      const startIndex = lines[0].startsWith('#!') ? 1 : 0;
      lines.splice(startIndex, 0, `import { logger } from '${importPath}'`);
    }

    fs.writeFileSync(filePath, lines.join('\n'));
    console.log(`✅ Added logger import to ${file}`);
  }
});