# Optional native helper — “Show in folder” (Finder / Explorer)

Chrome’s `chrome.downloads.show()` only works when the browser still has a **download id**. After you reinstall the extension or restore `download.json`, those ids are often **stale**, so Chrome cannot open the system file manager for you.

This folder contains a **Native Messaging** host that runs:

- **macOS:** `open -R <file>` (reveal in Finder)
- **Windows:** `explorer /select,"<file>"`
- **Linux:** `nautilus --select`, `dolphin --select`, or `xdg-open` on the parent folder

## 1. Extension ID

1. Open `chrome://extensions`
2. Enable **Developer mode**
3. Copy **ID** for Aria2Chrome (different for unpacked vs Web Store)

## 2. Host manifest

Copy `com.deibhaid.aria2chrome.reveal.json.template` to Chrome’s Native Messaging hosts directory and **edit**:

| Platform | Copy JSON to |
|----------|----------------|
| macOS | `~/Library/Application Support/Google/Chrome/NativeMessagingHosts/` |
| Linux | `~/.config/google-chrome/NativeMessagingHosts/` |
| Windows | `%LOCALAPPDATA%\Google\Chrome\User Data\NativeMessagingHosts\` |

Rename to **`com.deibhaid.aria2chrome.reveal.json`** (no `.template`).

Set:

- **`path`**: absolute path to this folder’s **`reveal_in_folder.py`** (macOS/Linux) or **`run_host.bat`** (Windows)
- **`allowed_origins`**: `chrome-extension://YOUR_EXTENSION_ID_HERE/`

## 3. Permissions (macOS / Linux)

```bash
chmod +x reveal_in_folder.py
```

On Windows, ensure `python` is on `PATH` (or edit `run_host.bat` to use the full path to `python.exe`).

## 4. Reload the extension

Reload Aria2Chrome in `chrome://extensions`. **Show in folder** should open Finder/Explorer with the file selected, including for **restored** downloads with only a local `filePath`.
