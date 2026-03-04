#!/bin/bash
set -euo pipefail

DEV_DIR="$(cd "$(dirname "$0")" && pwd)"
MARKETPLACE_DIR="$HOME/Library/Mobile Documents/com~apple~CloudDocs/Developer/oliver-claude-marketplace/extensions/ynab-mcp-server"
BUMP="${1:-patch}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: ./publish.sh [patch|minor|major]  (default: patch)"
  exit 1
fi

# Bump version in dev repo
cd "$DEV_DIR"
NEW_VERSION=$(node -e "
  const pkg = JSON.parse(require('fs').readFileSync('package.json','utf8'));
  const [maj,min,pat] = pkg.version.split('.').map(Number);
  const v = '$BUMP' === 'major' ? \`\${maj+1}.0.0\` :
            '$BUMP' === 'minor' ? \`\${maj}.\${min+1}.0\` :
                                  \`\${maj}.\${min}.\${pat+1}\`;
  console.log(v);
")
echo "Bumping $BUMP → $NEW_VERSION"

# Update version in both package.json files
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
  pkg.version = '$NEW_VERSION';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Copy files to marketplace
echo "Copying to marketplace..."
cp index.js package.json package-lock.json "$MARKETPLACE_DIR/"

# Update marketplace package.json (has scoped name, bin, files, etc.)
cd "$MARKETPLACE_DIR"
node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
  pkg.version = '$NEW_VERSION';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');
"

# Install deps in marketplace copy
npm install --production --silent

# Verify no secrets in publish payload
echo "Verifying publish contents..."
FILES=$(npm pack --dry-run 2>&1 | grep -c "index.js\|package.json")
if [[ "$FILES" -ne 2 ]]; then
  echo "ERROR: Expected 2 files in package, got unexpected contents:"
  npm pack --dry-run 2>&1
  exit 1
fi

# Publish to npm
echo "Publishing @oliverames/ynab-mcp-server@$NEW_VERSION..."
npm publish --access public

# Commit and push marketplace
cd "$MARKETPLACE_DIR/.."
cd "$(git rev-parse --show-toplevel)"
git add extensions/ynab-mcp-server/
git commit -m "Update @oliverames/ynab-mcp-server to $NEW_VERSION"
git push

echo ""
echo "Done! Published @oliverames/ynab-mcp-server@$NEW_VERSION"
