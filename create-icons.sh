#!/bin/bash

# Create Chrome extension icons from source image
# Prefers rocket.png if available, otherwise creates a simple SVG placeholder

cd "$(dirname "$0")/icons"

# Check if rocket.png exists and use it as the source
if [ -f "rocket.png" ]; then
    SOURCE_IMAGE="rocket.png"
    echo "Using rocket.png as source image"
else
    # Create a simple SVG icon as fallback
    cat > icon.svg << 'SVGEOF'
<svg width="128" height="128" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="grad" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" style="stop-color:#667eea;stop-opacity:1" />
      <stop offset="100%" style="stop-color:#764ba2;stop-opacity:1" />
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="24" fill="url(#grad)"/>
  <path d="M 64 32 L 64 96 M 40 64 L 64 96 M 88 64 L 64 96" stroke="white" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
  <circle cx="64" cy="64" r="48" stroke="white" stroke-width="4" fill="none" opacity="0.3"/>
</svg>
SVGEOF
    SOURCE_IMAGE="icon.svg"
    echo "Using generated SVG as source image"
fi

# Convert to required sizes
if [ "$SOURCE_IMAGE" = "icon.svg" ]; then
    # Use rsvg-convert for SVG (faster and more reliable)
    if command -v rsvg-convert &> /dev/null; then
        rsvg-convert --width=128 --height=128 "$SOURCE_IMAGE" -o icon128.png
        rsvg-convert --width=48 --height=48 "$SOURCE_IMAGE" -o icon48.png
        rsvg-convert --width=16 --height=16 "$SOURCE_IMAGE" -o icon16.png
        echo "✅ Icons created successfully using rsvg-convert"
    elif command -v magick &> /dev/null; then
        magick "$SOURCE_IMAGE" -resize 128x128 icon128.png
        magick "$SOURCE_IMAGE" -resize 48x48 icon48.png
        magick "$SOURCE_IMAGE" -resize 16x16 icon16.png
        echo "✅ Icons created successfully using ImageMagick"
    else
        echo "❌ Neither rsvg-convert nor ImageMagick found."
        echo "Please install librsvg (brew install librsvg) or ImageMagick"
        exit 1
    fi
else
    # Use ImageMagick for PNG source (non-square → square via center crop).
    # Plain -resize WxH preserves aspect ratio, which breaks Chrome/Web Store
    # (e.g. 548×864 → 81×128). ^ = fill the box, then -extent crops to square.
    if command -v magick &> /dev/null; then
        magick "$SOURCE_IMAGE" -resize 128x128^ -gravity center -extent 128x128 -quality 100 icon128.png
        magick "$SOURCE_IMAGE" -resize 48x48^ -gravity center -extent 48x48 -quality 100 icon48.png
        magick "$SOURCE_IMAGE" -resize 16x16^ -gravity center -extent 16x16 -quality 100 icon16.png
        echo "✅ Icons created successfully from rocket.png"
    else
        echo "❌ ImageMagick not found. Please install it: brew install imagemagick"
        exit 1
    fi
fi

echo ""
ls -lh icon*.png
