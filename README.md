# Aria2Chrome

A powerful Chrome extension that automatically captures download links and manages them using aria2c with intelligent resume support, accurate progress tracking, and smart retry mechanisms.

## Features

- 🎥 **Automatic Video Detection**: Intercepts clicks on video file links (.mp4, .mkv, .avi, .mov, .webm, and more)
- 📥 **aria2c Integration**: Sends downloads directly to your aria2c daemon via JSON-RPC
- 🔄 **Auto-Resume**: Automatically resumes failed or interrupted downloads
- 📊 **Download Tracking**: Monitor download progress, speed, and status in real-time
- 🎨 **Beautiful UI**: Modern, intuitive interface for managing your downloads
- 🔔 **Notifications**: Get notified when downloads are added or completed
- ⚙️ **Easy Configuration**: Simple setup with connection testing
- 📂 **HTTP Directory Download-All**: Floating button and context menu on "Index of /" style pages to batch send every file in the open directory to aria2

## Screenshots

The extension provides:
- A popup interface showing all active and completed downloads
- Real-time progress tracking with download speeds
- Easy pause/resume/remove controls
- A configuration page for aria2 RPC settings

## Prerequisites

Before using this extension, you need to have aria2c installed and running with RPC enabled.

### Installing aria2c

**macOS:**
```bash
brew install aria2
```

**Ubuntu/Debian:**
```bash
sudo apt-get install aria2
```

**Windows:**
Download from [aria2 releases](https://github.com/aria2/aria2/releases)

### Running aria2c with RPC

Basic command (no authentication):
```bash
aria2c --enable-rpc --rpc-listen-all=true
```

With secret token (recommended):
```bash
aria2c --enable-rpc --rpc-listen-all=true --rpc-secret=YOUR_SECRET_TOKEN
```

With custom download directory:
```bash
aria2c --enable-rpc --rpc-listen-all=true --dir=/path/to/downloads
```

Full featured command:
```bash
aria2c \
  --enable-rpc \
  --rpc-listen-all=true \
  --rpc-secret=YOUR_SECRET_TOKEN \
  --dir=/path/to/downloads \
  --max-connection-per-server=16 \
  --split=16 \
  --min-split-size=1M \
  --continue=true \
  --max-concurrent-downloads=5
```

**Tip**: Create an alias or systemd service to run aria2c automatically on system startup.

## Browser Compatibility

✅ **Fully Supported Browsers:**
- Google Chrome
- Mozilla Firefox (109+)
- Microsoft Edge
- Brave
- Opera
- Vivaldi
- Any Chromium-based browser

## Installation

### Chrome/Chromium Browsers

1. Clone or download this repository
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" in the top right corner
4. Click "Load unpacked"
5. Select the `aria2-downloader-extension` directory
6. The extension icon should appear in your toolbar

### Firefox

1. Clone or download this repository
2. Open Firefox and navigate to `about:debugging`
3. Click "This Firefox"
4. Click "Load Temporary Add-on..."
5. Navigate to the extension directory and select `manifest.json`

**Note:** For permanent Firefox installation, see [INSTALL-FIREFOX.md](INSTALL-FIREFOX.md)

### Chrome Web Store / Firefox Add-ons (Coming Soon)

_The extension will be published to official stores soon._

## Configuration

1. Click the extension icon in your toolbar
2. Click the settings (⚙️) button
3. Configure your aria2 RPC settings:
   - **RPC URL**: Default is `http://localhost:6800/jsonrpc`
   - **RPC Secret**: Enter your secret token if you set one
   - **Download Directory**: Optional, override aria2's default download location
4. Click "Test Connection" to verify the connection
5. Click "Save Settings"

## Usage

### Basic Usage

1. Browse any website with video links
2. Click on a video file link (.mp4, .mkv, etc.)
3. The extension will automatically:
   - Intercept the click
   - Add the video to aria2 queue
   - Show a notification
   - Start tracking the download

### Managing Downloads

Open the extension popup to:
- View all downloads with real-time progress
- See download speeds and file sizes
- Pause/resume downloads
- Remove downloads from the queue
- Monitor completion status

### Downloading Entire HTTP Directory Listings

When you visit an open HTTP directory (for example, classic `Index of /` pages such as [https://docs.oasis-open.org/](https://docs.oasis-open.org/)), Aria2Chrome now injects a floating **“Aria2Chrome Download All”** button and exposes a right-click context menu entry. Use either control to:

1. Detect every direct file link within the current directory (excludes `Parent Directory` and subfolders).
2. Send each file to aria2 via JSON-RPC using the same cookies/referrer as your browser session.
3. Show a toast summarizing how many files were added, skipped as duplicates, or failed.

Prefer keyboard + mouse workflows? Right-click anywhere on the directory listing and choose **Aria2Chrome → Download all files in directory** to trigger the same batch job without scrolling to the floating action button.

### Persistent Rolling Logs

Aria2Chrome now keeps a rolling buffer (last 500 entries) of background events inside the browser at `chrome.storage.local` under the key `aria2Logs` (Chrome DevTools → Application → Storage → `chrome.storage.local` → `aria2Logs`). Use this when debugging queue issues or RPC failures—no filesystem access required.
This is perfect for mirrors and standards archives that expose HTTP indexes without individual downloads pages.

### Supported Video Formats

The extension detects the following video file extensions:
- `.mp4`, `.mkv`, `.avi`, `.mov`, `.wmv`, `.flv`
- `.webm`, `.m4v`, `.mpg`, `.mpeg`, `.3gp`
- `.ogv`, `.ts`, `.m3u8`, `.f4v`, `.vob`
- `.rm`, `.rmvb`

## Features in Detail

### Automatic Resume

The extension monitors all downloads and automatically resumes them if:
- The download encounters an error
- The connection is interrupted
- aria2c restarts

### Download Tracking

Each download is tracked with:
- Original URL and filename
- Source page URL and title
- Download progress (percentage)
- Download speed
- File size (total and completed)
- Status (active, paused, complete, error, waiting)

### Notifications

Get browser notifications for:
- Download added to queue
- Download completed
- Download errors

## Troubleshooting

### Extension not capturing video links

- Make sure the link has a recognized video file extension
- Check that the extension is enabled
- Reload the webpage

### Connection errors

- Verify aria2c is running: `ps aux | grep aria2c`
- Check the RPC URL is correct
- Test the connection in the settings page
- Check firewall settings

### Downloads not starting

- Ensure aria2c has write permissions to the download directory
- Check aria2c logs for errors
- Verify the video URL is accessible

### Auto-resume not working

- Check that aria2c is running continuously
- Verify the extension has the correct RPC credentials
- Look for errors in the Chrome DevTools console

## Advanced Configuration

### Custom aria2c Configuration File

Create a configuration file at `~/.aria2/aria2.conf`:

```conf
# RPC Configuration
enable-rpc=true
rpc-listen-all=true
rpc-secret=YOUR_SECRET_TOKEN
rpc-listen-port=6800

# Download Settings
dir=/path/to/downloads
max-connection-per-server=16
split=16
min-split-size=1M
continue=true
max-concurrent-downloads=5

# Advanced Options
file-allocation=falloc
disk-cache=64M
timeout=60
retry-wait=3
max-tries=5
```

Run aria2c with the config file:
```bash
aria2c --conf-path=~/.aria2/aria2.conf
```

### Running aria2c as a Service

**macOS (launchd):**

Create `~/Library/LaunchAgents/aria2.plist`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>aria2</string>
    <key>ProgramArguments</key>
    <array>
        <string>/opt/homebrew/bin/aria2c</string>
        <string>--conf-path=/Users/YOUR_USERNAME/.aria2/aria2.conf</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
</dict>
</plist>
```

Load the service:
```bash
launchctl load ~/Library/LaunchAgents/aria2.plist
```

**Linux (systemd):**

Create `/etc/systemd/system/aria2.service`:
```ini
[Unit]
Description=Aria2 Download Manager
After=network.target

[Service]
Type=simple
User=YOUR_USERNAME
ExecStart=/usr/bin/aria2c --conf-path=/home/YOUR_USERNAME/.aria2/aria2.conf
Restart=always

[Install]
WantedBy=multi-user.target
```

Enable and start the service:
```bash
sudo systemctl enable aria2
sudo systemctl start aria2
```

## Development

### Project Structure

```
aria2-downloader-extension/
├── manifest.json           # Extension manifest
├── background.js          # Service worker for aria2 RPC communication
├── content.js            # Content script for intercepting video clicks
├── popup.html            # Popup UI HTML
├── popup.css             # Popup UI styles
├── popup.js              # Popup UI logic
├── options.html          # Settings page HTML
├── options.css           # Settings page styles
├── options.js            # Settings page logic
├── icons/                # Extension icons
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md            # This file
```

### Building from Source

1. Clone the repository:
```bash
git clone <repository-url>
cd aria2-downloader-extension
```

2. Generate icons (requires ImageMagick):
```bash
./create-icons.sh
```

3. Load in Chrome as described in the Installation section

### Contributing

Contributions are welcome! Please feel free to submit issues or pull requests.

## Privacy

This extension:
- Does NOT collect or send any personal data
- Only communicates with your local aria2c instance
- Stores configuration locally in Chrome's storage
- Does NOT track your browsing history

## License

MIT License - feel free to use, modify, and distribute.

## Credits

- Built with ❤️ for aria2c users
- Uses aria2c JSON-RPC API
- Inspired by the need for better video download management

## Support

For issues, questions, or feature requests, please:
- Open an issue on GitHub
- Check existing issues for solutions
- Consult the aria2c documentation

## Changelog

### Version 1.0.0
- Initial release
- Video link interception
- aria2c RPC integration
- Download tracking and management
- Auto-resume functionality
- Settings page with connection testing
- Real-time progress monitoring

## Roadmap

Future features planned:
- [x] Batch download support (HTTP directory "Download All")
- [ ] Custom file naming patterns
- [ ] Download history
- [ ] Statistics and analytics
- [ ] Dark mode
- [ ] Multi-language support
- [ ] Context menu integration
- [ ] Keyboard shortcuts

---

**Note**: This extension requires aria2c to be installed and running. It does not include aria2c itself.
