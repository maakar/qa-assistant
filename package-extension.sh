#!/usr/bin/env bash
# Build a minimal Chrome Web Store ZIP. Never overwrite an existing archive.
set -euo pipefail

if (( $# > 1 )); then
  echo "Usage: $0 [output.zip]" >&2
  exit 1
fi

SOURCE_DIR=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
REQUIRED_FILES=(
  manifest.json
  background.js
  sidepanel.html
  sidepanel.js
  content.js
  content-styles.css
  knowledge_seed.json
  icons/icon-16.png
  icons/icon-48.png
  icons/icon-128.png
  LICENSE
)

for file in "${REQUIRED_FILES[@]}"; do
  if [[ ! -f "$SOURCE_DIR/$file" ]]; then
    echo "ERROR: Required file missing: $file" >&2
    exit 1
  fi
done

VERSION=$(node -e "console.log(JSON.parse(require('fs').readFileSync(process.argv[1], 'utf8')).version)" "$SOURCE_DIR/manifest.json")
if [[ ! "$VERSION" =~ ^[0-9]+(\.[0-9]+){0,3}$ ]]; then
  echo "ERROR: Invalid manifest version: $VERSION" >&2
  exit 1
fi

# An explicit relative path is relative to the caller's working directory.
OUTPUT=${1:-"$SOURCE_DIR/qa-assistant-v${VERSION}.zip"}
if [[ "$OUTPUT" != /* ]]; then OUTPUT="$PWD/$OUTPUT"; fi
if [[ "$OUTPUT" != *.zip ]]; then
  echo "ERROR: Output path must end in .zip" >&2
  exit 1
fi
if [[ -e "$OUTPUT" || -L "$OUTPUT" ]]; then
  echo "ERROR: Output already exists: $OUTPUT (choose another path)" >&2
  exit 1
fi
OUTPUT_DIR=$(dirname -- "$OUTPUT")
if [[ ! -d "$OUTPUT_DIR" ]]; then
  echo "ERROR: Output directory does not exist: $OUTPUT_DIR" >&2
  exit 1
fi

# Build next to the destination and link into place without clobbering a file
# created by another process while the archive was being built.
TEMP_ZIP=$(mktemp "$OUTPUT_DIR/.qa-assistant-XXXXXX.zip")
trap 'rm -f -- "$TEMP_ZIP"' EXIT
rm -- "$TEMP_ZIP"
(cd "$SOURCE_DIR" && zip -q "$TEMP_ZIP" "${REQUIRED_FILES[@]}")
unzip -tq "$TEMP_ZIP" >/dev/null
if ! ln -- "$TEMP_ZIP" "$OUTPUT"; then
  echo "ERROR: Could not create output (it may already exist): $OUTPUT" >&2
  exit 1
fi

echo "Created: $OUTPUT"
echo "Version: $VERSION"
echo "Archive contents:"
unzip -l "$OUTPUT"
