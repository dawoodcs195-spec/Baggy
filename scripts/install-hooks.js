// Installs the versioned git hooks: git config core.hooksPath .githooks
// Run once per clone: npm run hooks:install
'use strict';
const { execSync } = require('child_process');
try {
  execSync('git rev-parse --git-dir', { stdio: 'ignore' });
} catch {
  console.error('✗ Not a git repository — run this again after `git init` to activate the pre-commit audits.');
  process.exit(1);
}
execSync('git config core.hooksPath .githooks', { stdio: 'inherit' });
console.log('✓ Git hooks installed: core.hooksPath → .githooks');
console.log('  Pre-commit now runs: audit:renders + audit:routes + smoke');
