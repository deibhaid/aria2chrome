# Quick Installation Guide

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

## Step 3: Install the Chrome Extension

1. Open Chrome and go to `chrome://extensions/`
2. Enable "Developer mode" (toggle in top right)
3. Click "Load unpacked"
4. Navigate to and select this directory: `~/ws/aria2-downloader-extension`
5. The extension icon should appear in your toolbar

## Step 4: Configure the Extension

1. Click the extension icon
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

## Troubleshooting

**"Connection failed" error:**
- Make sure aria2c is running (check the terminal)
- Verify the RPC URL is correct
- Check that no firewall is blocking port 6800

**Video links not being captured:**
- Make sure the link ends with a video extension (.mp4, .mkv, etc.)
- Reload the webpage after installing the extension

**Need help?**
Check the full README.md for detailed documentation.
