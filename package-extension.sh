#!/usr/bin/env bash
# package-extension.sh — Creates a clean, compliant ZIP package for Chrome Web Store submission
set -euo pipefail

EXTENSION_NAME="qa-assistant"
VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync('./manifest.json','utf8')).version)")
OUTPUT="${EXTENSION_NAME}-v${VERSION}.zip"

echo "=========================================="
echo " Packaging: ${EXTENSION_NAME} v${VERSION}"
echo "=========================================="

# Remove previous archive if exists
rm -f "$OUTPUT"

# Verify required files exist
REQUIRED_FILES=(
  "manifest.json"
  "background.js"
  "sidepanel.html"
  "sidepanel.js"
  "content.js"
  "content-styles.css"
  "knowledge_seed.json"
  "icons/icon-16.png"
  "icons/icon-48.png"
  "icons/icon-128.png"
)

for file in "${REQUIRED_FILES[@]}"; do
  if [ ! -f "$file" ]; then
    echo "ERROR: Required file missing: $file"
    exit 1
  fi
done

# Create ZIP archive excluding developer, documentation, and asset files
zip -r "$OUTPUT" . \
  -x ".git/*" \
  -x "node_modules/*" \
  -x ".env" \
  -x "*.map" \
  -x "*.md" \
  -x "*.sh" \
  -x "*.py" \
  -x "store-assets/*" \
  -x "*.zip" \
  -x ".DS_Store" \
  -x "Thumbs.db"

echo ""
echo "Successfully created: $OUTPUT"
echo "Package size: $(du -h "$OUTPUT" | cut -f1)"
echo ""
echo "Archive contents:"
unzip -l "$OUTPUT"
