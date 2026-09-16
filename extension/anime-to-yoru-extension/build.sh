#!/usr/bin/env sh
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
SRC="$ROOT/src"
MANIFESTS="$ROOT/manifests"
DIST="$ROOT/dist"
VERSION="3.2.0"

mkdir -p "$DIST"

build_one() {
  NAME="$1"
  MANIFEST="$2"
  TARGET="$DIST/Anime-to-YORU-$NAME-v$VERSION"
  ARCHIVE="$DIST/Anime-to-YORU-$NAME-v$VERSION.zip"

  rm -rf "$TARGET" "$ARCHIVE"
  mkdir -p "$TARGET"
  cp -R "$SRC"/. "$TARGET"/
  cp "$MANIFESTS/$MANIFEST" "$TARGET/manifest.json"
  (cd "$TARGET" && zip -qr "$ARCHIVE" .)
  printf 'Built: %s\n' "$TARGET"
}

build_one "Chromium" "manifest.chromium.json"
build_one "Firefox" "manifest.firefox.json"
cp "$DIST/Anime-to-YORU-Firefox-v$VERSION.zip" "$DIST/Anime-to-YORU-Firefox-v$VERSION.xpi"
build_one "Safari-WebExtension" "manifest.safari.json"
