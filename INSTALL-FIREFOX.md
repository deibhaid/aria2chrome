# Firefox Installation Guide

This extension now supports both **Chrome/Chromium browsers** and **Firefox**!

## Step 1: Install aria2c

### macOS
```bash
brew install aria2
```

### Ubuntu/Debian
```bash
sudo apt-get install aria2
```

### Windows
Download from https://github.com/aria2/aria2/releases

## Step 2: Start aria2c with RPC

Run this command in a terminal:
```bash
aria2c --enable-rpc --rpc-listen-all=true
```

Or with a secret token (recommended):
```bash
aria2c --enable-rpc --rpc-listen-all=true --rpc-secret=mysecret123
```

Keep this terminal window open.

## Step 3: Install the Firefox Extension

### Temporary Installation (Development/Testing)

1. Open Firefox and navigate to `about:debugging`
2. Click "This Firefox" in the left sidebar
3. Click "Load Temporary Add-on..."
4. Navigate to the extension directory and select the `manifest.json` file
5. The extension will be loaded temporarily (until you restart Firefox)

### Permanent Installation (Requires Signing)

For permanent installation, the extension needs to be:

**Option A: Self-Distribution (Unsigned)**
1. Go to `about:config` in Firefox
2. Search for `xpinstall.signatures.required`
3. Set it to `false` (Developer Edition or Nightly only)
4. Then load the extension as a temporary add-on

**Option B: Sign and Distribute**
1. Create an account at https://addons.mozilla.org
2. Submit the extension for signing
3. Install the signed `.xpi` file

**Option C: Use Firefox Developer Edition**
- Firefox Developer Edition allows unsigned extensions
- Download from: https://www.mozilla.org/firefox/developer/

## Step 4: Configure the Extension

1. Click the extension icon (you may need to pin it from the puzzle icon menu)
2. Click the settings (⚙️) button
3. Enter your aria2 RPC settings:
   - RPC URL: `http://localhost:6800/jsonrpc`
   - RPC Secret: (if you set one, e.g., `mysecret123`)
4. Click "Test Connection" to verify
5. Click "Save Settings"

## Step 5: Test It

1. Find any webpage with video links
2. Click on a video file (.mp4, .mkv, etc.)
3. The extension will capture it and add to aria2
4. Open the extension popup to see download progress

## Differences from Chrome Version

- Both versions work identically
- Uses WebExtension Polyfill for API compatibility
- Same features, same UI, same functionality

## Troubleshooting

### "Extension is not signed" warning
- Use Firefox Developer Edition for development
- Or submit to Mozilla Add-ons for signing

### "Connection failed" error:
- Make sure aria2c is running (check the terminal)
- Verify the RPC URL is correct
- Check that no firewall is blocking port 6800

### Video links not being captured:
- Make sure the link ends with a video extension (.mp4, .mkv, etc.)
- Reload the webpage after installing the extension
- Check the browser console for errors

### Extension disappears after Firefox restart:
- This is normal for temporary add-ons
- You need to reload it each time, or get it signed for permanent installation

## Need Help?

Check the main README.md for detailed documentation and advanced configuration options.

## Browser Compatibility

✅ **Supported Browsers:**
- Firefox 109+
- Google Chrome
- Microsoft Edge
- Brave
- Opera
- Vivaldi
- Any Chromium-based browser

