#!/bin/bash
set -euo pipefail

DEV_DIR="$(cd "$(dirname "$0")" && pwd)"
BUMP="${1:-patch}"

if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  echo "Usage: ./publish.sh [patch|minor|major]  (default: patch)"
  exit 1
fi

cd "$DEV_DIR"

# Bump version
NEW_VERSION=$(node -e "
  const pkg = JSON.parse(require('fs').readFileSync('package.json','utf8'));
  const [maj,min,pat] = pkg.version.split('.').map(Number);
  const v = '$BUMP' === 'major' ? \`\${maj+1}.0.0\` :
            '$BUMP' === 'minor' ? \`\${maj}.\${min+1}.0\` :
                                  \`\${maj}.\${min}.\${pat+1}\`;
  console.log(v);
")
echo "Bumping $BUMP -> $NEW_VERSION"

node -e "
  const fs = require('fs');
  const pkg = JSON.parse(fs.readFileSync('package.json','utf8'));
  pkg.version = '$NEW_VERSION';
  fs.writeFileSync('package.json', JSON.stringify(pkg, null, 2) + '\n');

  const lockPath = 'package-lock.json';
  if (fs.existsSync(lockPath)) {
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    lock.name = pkg.name;
    lock.version = pkg.version;
    if (lock.packages && lock.packages['']) {
      lock.packages[''].name = pkg.name;
      lock.packages[''].version = pkg.version;
    }
    fs.writeFileSync(lockPath, JSON.stringify(lock, null, 2) + '\n');
  }
"

# Verify publish contents
echo "Verifying publish contents..."
npm pack --dry-run 2>&1

# Publish to npm
echo ""
echo "Publishing @oliverames/ynab-mcp-server@$NEW_VERSION..."
npm publish --access public

echo ""
echo "Done! Published @oliverames/ynab-mcp-server@$NEW_VERSION"
