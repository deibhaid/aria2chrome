#!/bin/bash

# Create Chrome extension icons from source image
# Prefers rocket.png if available, otherwise creates a simple SVG placeholder
#
# Writes:
#   icon{16,48,128}.png — used by the extension (manifest, notifications, etc.)
#   chrome-web-store-icon{16,48,128}.png — square listing assets for Chrome Web
#   Store (only when source is PNG; non-square sources need crop + extent)

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
    # Use ImageMagick for PNG source — extension icons (preserve aspect ratio)
    if command -v magick &> /dev/null; then
        magick "$SOURCE_IMAGE" -resize 128x128 -quality 100 icon128.png
        magick "$SOURCE_IMAGE" -resize 48x48 -quality 100 icon48.png
        magick "$SOURCE_IMAGE" -resize 16x16 -quality 100 icon16.png
        echo "✅ Extension icons created from rocket.png"

        # Square crops for Chrome Web Store listing (non-square sources → ^ + extent)
        magick "$SOURCE_IMAGE" -resize 128x128^ -gravity center -extent 128x128 -quality 100 chrome-web-store-icon128.png
        magick "$SOURCE_IMAGE" -resize 48x48^ -gravity center -extent 48x48 -quality 100 chrome-web-store-icon48.png
        magick "$SOURCE_IMAGE" -resize 16x16^ -gravity center -extent 16x16 -quality 100 chrome-web-store-icon16.png
        echo "✅ Chrome Web Store listing icons: chrome-web-store-icon{16,48,128}.png"
    else
        echo "❌ ImageMagick not found. Please install it: brew install imagemagick"
        exit 1
    fi
fi

echo ""
ls -lh icon16.png icon48.png icon128.png
if [ -f chrome-web-store-icon16.png ]; then
    ls -lh chrome-web-store-icon16.png chrome-web-store-icon48.png chrome-web-store-icon128.png
fi
