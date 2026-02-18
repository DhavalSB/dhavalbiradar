#!/bin/bash
# Drop raw photos into scripts/input/, run this script, and get
# optimized versions in both thumbnails/ and fullsrc/ gallery folders.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

INPUT_DIR="$SCRIPT_DIR/input"
THUMB_DIR="$PROJECT_DIR/static/images/gallery/thumbnails"
FULL_DIR="$PROJECT_DIR/static/images/gallery/fullsrc"

# Create dirs if needed
mkdir -p "$INPUT_DIR" "$THUMB_DIR" "$FULL_DIR"

# Check for images
shopt -s nullglob
images=("$INPUT_DIR"/*.{jpeg,jpg,png,JPEG,JPG,PNG,heic,HEIC,dng,DNG})

if [ ${#images[@]} -eq 0 ]; then
  echo "No images found in $INPUT_DIR"
  echo "Drop your photos there and run this script again."
  exit 0
fi

echo "Found ${#images[@]} image(s) to process..."
echo ""

for img in "${images[@]}"; do
  name="$(basename "${img%.*}")"
  ext="${img##*.}"
  out_ext="jpeg"

  echo "Processing: $(basename "$img")"

  # DNG/RAW files need a two-step process: convert to JPEG first, then resize
  if [[ "$ext" =~ ^(dng|DNG)$ ]]; then
    echo "  Converting RAW to JPEG..."
    tmpfile=$(mktemp /tmp/photo_convert_XXXXXX.jpeg)
    sips -s format jpeg "$img" --out "$tmpfile" 2>/dev/null
    src="$tmpfile"
  else
    src="$img"
    if [[ "$ext" =~ ^(jpg|JPG)$ ]]; then
      out_ext="jpg"
    fi
  fi

  # Thumbnail: 600px max, quality 70
  sips --resampleHeightWidthMax 600 -s formatOptions 70 \
    "$src" --out "$THUMB_DIR/${name}.${out_ext}" 2>/dev/null
  thumb_size=$(du -h "$THUMB_DIR/${name}.${out_ext}" | cut -f1 | xargs)
  echo "  → thumbnail: ${name}.${out_ext} ($thumb_size)"

  # Fullsrc: 2000px max, quality 80
  sips --resampleHeightWidthMax 2000 -s formatOptions 80 \
    "$src" --out "$FULL_DIR/${name}.${out_ext}" 2>/dev/null
  full_size=$(du -h "$FULL_DIR/${name}.${out_ext}" | cut -f1 | xargs)
  echo "  → fullsrc:   ${name}.${out_ext} ($full_size)"

  # Clean up temp file if DNG
  [[ -n "${tmpfile:-}" ]] && rm -f "$tmpfile" && unset tmpfile

  # Strip location metadata for privacy
  if command -v exiftool &>/dev/null; then
    exiftool -GPS:all= -overwrite_original \
      "$THUMB_DIR/${name}.${out_ext}" "$FULL_DIR/${name}.${out_ext}" 2>/dev/null
    echo "  ✓ location metadata stripped"
  fi

  echo ""
done

echo "Done! Add to templates/photos.html:"
echo ""
for img in "${images[@]}"; do
  name="$(basename "${img%.*}")"
  ext="${img##*.}"
  out_ext="jpeg"
  [[ "$ext" =~ ^(jpg|JPG)$ ]] && out_ext="jpg"
  echo "  <img src=\"/images/gallery/thumbnails/${name}.${out_ext}\" data-fullsrc=\"/images/gallery/fullsrc/${name}.${out_ext}\">"
done
echo ""
echo "Clear input folder? (y/n)"
read -r answer
if [[ "$answer" == "y" ]]; then
  rm -f "${images[@]}"
  echo "Input folder cleared."
fi
