// Options page script

// Predefined file extensions by category
const FILE_EXTENSIONS = {
  video: [
    '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', 
    '.mpg', '.mpeg', '.3gp', '.ogv', '.ts', '.m3u8', '.f4v', '.vob', 
    '.rm', '.rmvb', '.divx', '.xvid', '.m2ts', '.mts', '.asf'
  ],
  audio: [
    '.mp3', '.flac', '.wav', '.aac', '.ogg', '.m4a', '.wma', '.opus',
    '.ape', '.alac', '.aiff', '.dsd', '.dsf', '.dff', '.mka', '.tta',
    '.ac3', '.dts', '.amr', '.mid', '.midi', '.ra'
  ],
  archive: [
    '.zip', '.rar', '.7z', '.tar', '.gz', '.bz2', '.xz', '.iso',
    '.tar.gz', '.tar.bz2', '.tar.xz', '.tgz', '.tbz', '.txz',
    '.zipx', '.cab', '.arj', '.lzh', '.ace', '.jar', '.war', '.apk'
  ],
  disk: [
    '.iso', '.img', '.dmg', '.vhd', '.vhdx', '.vmdk', '.qcow2',
    '.vdi', '.bin', '.cue', '.mdf', '.mds', '.nrg', '.toast', '.udf'
  ]
};

// Default selected extensions (video files by default)
const DEFAULT_EXTENSIONS = FILE_EXTENSIONS.video;
const DEFAULT_DOWNLOAD_DIR_HINT = '/home/username/Downloads/';

// Auto-sync with native_host/* files (all-in-one installer embeds these verbatim).
const NATIVE_HOST_PY_EMBED = "#!/usr/bin/env python3\n\"\"\"\nChrome Native Messaging host (minimal): reveal one absolute file path in the OS file manager.\n\nChrome sends one JSON object per message:  {\"path\": \"/absolute/path/to/file\"}\nReply: {\"ok\": true} or {\"ok\": false, \"error\": \"reason\"}\n\nNo network, no telemetry, stdlib only. See README.md for install and policy notes.\n\"\"\"\nfrom __future__ import annotations\n\nimport json\nimport os\nimport platform\nimport struct\nimport subprocess\nimport sys\nfrom typing import Any, Dict, Optional\n\nSTRUCT_FMT = struct.Struct(\"<I\")\nMAX_MSG = 1024 * 64\n\n\ndef read_message() -> Optional[Dict[str, Any]]:\n    raw_len = sys.stdin.buffer.read(4)\n    if len(raw_len) != 4:\n        return None\n    (length,) = STRUCT_FMT.unpack(raw_len)\n    if length > MAX_MSG:\n        return {\"_bad\": \"message too large\"}\n    data = sys.stdin.buffer.read(length)\n    if len(data) != length:\n        return None\n    try:\n        return json.loads(data.decode(\"utf-8\"))\n    except (UnicodeDecodeError, json.JSONDecodeError) as e:\n        return {\"_bad\": f\"invalid json: {e}\"}\n\n\ndef write_message(obj: Dict[str, Any]) -> None:\n    payload = json.dumps(obj, separators=(\",\", \":\")).encode(\"utf-8\")\n    sys.stdout.buffer.write(STRUCT_FMT.pack(len(payload)))\n    sys.stdout.buffer.write(payload)\n    sys.stdout.buffer.flush()\n\n\ndef reveal(path: str) -> Dict[str, Any]:\n    if not isinstance(path, str) or not path.strip():\n        return {\"ok\": False, \"error\": \"missing path\"}\n    path = path.strip()\n    if not os.path.isabs(path):\n        return {\"ok\": False, \"error\": \"path must be absolute\"}\n    if not os.path.exists(path):\n        return {\"ok\": False, \"error\": \"path does not exist\"}\n\n    system = platform.system()\n    try:\n        if system == \"Darwin\":\n            subprocess.run([\"/usr/bin/open\", \"-R\", path], check=False, capture_output=True)\n        elif system == \"Windows\":\n            subprocess.run(\n                [\"explorer\", \"/select,\" + os.path.normpath(path)],\n                check=False,\n                capture_output=True,\n            )\n        else:\n            subprocess.run(\n                [\"xdg-open\", os.path.dirname(path)],\n                check=False,\n                capture_output=True,\n            )\n        return {\"ok\": True}\n    except Exception as e:\n        return {\"ok\": False, \"error\": str(e)}\n\n\ndef main() -> None:\n    while True:\n        msg = read_message()\n        if msg is None:\n            break\n        if isinstance(msg, dict) and \"_bad\" in msg:\n            write_message({\"ok\": False, \"error\": msg[\"_bad\"]})\n            continue\n        if not isinstance(msg, dict) or \"path\" not in msg:\n            write_message({\"ok\": False, \"error\": \"expected {\\\"path\\\": \\\"/absolute/...\\\"}\"})\n            continue\n        write_message(reveal(msg[\"path\"]))\n\n\nif __name__ == \"__main__\":\n    main()\n";
const NATIVE_HOST_SH_EMBED = "#!/bin/bash\n# Wrapper so Chrome Native Messaging \"path\" is a single executable (see README).\nexec \"$(dirname \"$0\")/aria2chrome_native_host.py\"\n";
const NATIVE_HOST_BAT_EMBED = "@echo off\nREM Native Messaging wrapper for Chrome on Windows (single executable path in manifest).\npython \"%~dp0aria2chrome_native_host.py\"\n";

let selectedExtensions = [];
let customExtensions = [];

function clampInt(n, lo, hi) {
  const x = parseInt(String(n), 10);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

function parseHostLines(text) {
  return (text || '')
    .split(/\r?\n/)
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);
}

function hostsArrayToText(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return '';
  return arr.join('\n');
}

function sendMessagePromise(msg) {
  return new Promise((resolve, reject) => {
    try {
      chrome.runtime.sendMessage(msg, (r) => {
        const err = chrome.runtime.lastError;
        if (err) {
          reject(new Error(err.message));
        } else {
          resolve(r);
        }
      });
    } catch (e) {
      reject(e);
    }
  });
}

function applyOptionsTheme(theme) {
  const t = theme === 'light' || theme === 'dark' || theme === 'system' ? theme : 'system';
  document.documentElement.setAttribute('data-options-theme', t);
}

// Load saved settings
async function loadSettings() {
  const result = await chrome.storage.sync.get([
    'aria2Config',
    'fileExtensions',
    'customFileExtensions',
    'autoResume',
    'showNotifications',
    'nativeRevealEnabled',
    'nativeHostManifestOs',
    'nativeHostManifestUsername',
    'nativeHostManifestExtensionId',
    'maxConcurrentDownloads',
    'aria2PerDownloadOpts',
    'maxOverallDownloadLimit',
    'syncAria2GlobalLimits',
    'siteInterceptDenyHosts',
    'siteInterceptAllowHosts',
    'optionsTheme',
    'localHelperDetailsOpen'
  ]);
  
  // Load aria2 config
  if (result.aria2Config) {
    const config = result.aria2Config;
    document.getElementById('rpcUrl').value = config.rpcUrl || 'http://localhost:6800/jsonrpc';
    document.getElementById('secret').value = config.secret || '';
    document.getElementById('downloadDir').value = config.downloadDir || DEFAULT_DOWNLOAD_DIR_HINT;
  } else {
    document.getElementById('downloadDir').value = DEFAULT_DOWNLOAD_DIR_HINT;
  }
  
  // Load file extensions
  if (result.fileExtensions && result.fileExtensions.length > 0) {
    selectedExtensions = result.fileExtensions;
  } else {
    selectedExtensions = [...DEFAULT_EXTENSIONS];
  }
  
  // Load custom extensions
  if (result.customFileExtensions && result.customFileExtensions.length > 0) {
    customExtensions = result.customFileExtensions;
  }
  
  // Load behavior toggles
  document.getElementById('autoResume').checked = result.autoResume !== undefined ? result.autoResume : true;
  document.getElementById('showNotifications').checked = result.showNotifications !== undefined ? result.showNotifications : true;
  document.getElementById('nativeRevealEnabled').checked = result.nativeRevealEnabled === true;

  const mc = document.getElementById('maxConcurrentDownloads');
  if (mc) mc.value = String(clampInt(result.maxConcurrentDownloads ?? 5, 1, 32));
  const per = result.aria2PerDownloadOpts && typeof result.aria2PerDownloadOpts === 'object' ? result.aria2PerDownloadOpts : {};
  const splitEl = document.getElementById('aria2Split');
  const minSplitEl = document.getElementById('aria2MinSplitSize');
  const mcsEl = document.getElementById('aria2MaxConnPerServer');
  if (splitEl) splitEl.value = String(clampInt(per.split ?? 16, 1, 32));
  if (minSplitEl) minSplitEl.value = per.minSplitSize || '1M';
  if (mcsEl) mcsEl.value = String(clampInt(per.maxConnectionPerServer ?? 16, 1, 32));
  const mol = document.getElementById('maxOverallDownloadLimit');
  if (mol) mol.value = result.maxOverallDownloadLimit != null ? String(result.maxOverallDownloadLimit) : '';
  const syncGlob = document.getElementById('syncAria2GlobalLimits');
  if (syncGlob) syncGlob.checked = result.syncAria2GlobalLimits !== false;
  const denyTa = document.getElementById('siteInterceptDenyHosts');
  const allowTa = document.getElementById('siteInterceptAllowHosts');
  if (denyTa) denyTa.value = hostsArrayToText(result.siteInterceptDenyHosts);
  if (allowTa) allowTa.value = hostsArrayToText(result.siteInterceptAllowHosts);
  const themeSel = document.getElementById('optionsTheme');
  if (themeSel) {
    themeSel.value = result.optionsTheme === 'light' || result.optionsTheme === 'dark' ? result.optionsTheme : 'system';
    applyOptionsTheme(themeSel.value);
  }
  const localDetails = document.getElementById('section-local-helper');
  if (localDetails) {
    localDetails.open = result.localHelperDetailsOpen === true || result.nativeRevealEnabled === true;
  }

  const userEl = document.getElementById('nativeHostUsername');
  const idEl = document.getElementById('nativeHostExtensionId');
  if (userEl && result.nativeHostManifestUsername) {
    userEl.value = result.nativeHostManifestUsername;
  }
  if (idEl && result.nativeHostManifestExtensionId) {
    idEl.value = result.nativeHostManifestExtensionId;
  }
  void chrome.storage.sync.remove(['nativeHostManifestRevealPath']);
  const osSaved = result.nativeHostManifestOs;
  const osVal =
    osSaved === 'windows' || osSaved === 'linux' || osSaved === 'macos' ? osSaved : detectNativeHostOs();
  setNativeHostOsChoice(osVal, { skipLayout: true });
  updateNativeHostLayout();
  
  // Render extension checkboxes
  renderExtensions();
}

function buildNativeHostManifestDraft() {
  const userEl = document.getElementById('nativeHostUsername');
  const idEl = document.getElementById('nativeHostExtensionId');
  if (!idEl) return { username: '', id: '' };
  return {
    username: (userEl && userEl.value.trim()) || '',
    id: idEl.value.trim()
  };
}

/** Rough OS for standard Chrome/Edge extension directory layout. */
function detectNativeHostOs() {
  const p = navigator.platform || '';
  if (/^Win/i.test(p)) return 'windows';
  if (/^(Mac|iPhone)/i.test(p)) return 'macos';
  if (/Linux/i.test(p)) return 'linux';
  return 'macos';
}

const NATIVE_HOST_OS_IDS = new Set(['macos', 'windows', 'linux']);

/** Selected OS from options UI (drives paths, .sh/.bat, tabs, and the all-in-one script). */
function getNativeHostOsChoice() {
  const hid = document.getElementById('nativeHostOsActive');
  const v = hid && hid.value;
  if (v === 'windows' || v === 'linux' || v === 'macos') return v;
  return detectNativeHostOs();
}

/**
 * @param {'macos'|'windows'|'linux'} os
 * @param {{ skipLayout?: boolean }} [opts]
 */
function setNativeHostOsChoice(os, opts = {}) {
  const o = NATIVE_HOST_OS_IDS.has(os) ? os : detectNativeHostOs();
  const hid = document.getElementById('nativeHostOsActive');
  if (hid) hid.value = o;
  document.querySelectorAll('.native-host-os-tab').forEach((btn) => {
    const match = btn.getAttribute('data-native-host-os') === o;
    btn.setAttribute('aria-selected', match ? 'true' : 'false');
    btn.classList.toggle('native-host-os-tab--active', match);
    btn.tabIndex = match ? 0 : -1;
  });
  document.querySelectorAll('.native-host-os-steps-panel').forEach((panel) => {
    panel.hidden = panel.getAttribute('data-native-host-os') !== o;
  });
  const shell = document.getElementById('nativeHostOneShotShellLabel');
  if (shell) {
    if (o === 'windows') shell.textContent = 'Shell: Windows PowerShell';
    else shell.textContent = o === 'linux' ? 'Shell: bash (Linux)' : 'Shell: bash (macOS)';
  }
  if (!opts.skipLayout) updateNativeHostLayout();
}

/** Placeholder preview when username/ID are empty — varies by selected OS. */
function getNativeHostPlaceholderPreviewText() {
  const os = getNativeHostOsChoice();
  if (os === 'windows') {
    return `{
  "name": "com.aria2chrome.reveal",
  "description": "Aria2Chrome reveal",
  "path": "C:\\\\Users\\\\YOUR_USERNAME\\\\...\\\\native_host\\\\reveal-host.bat",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/"
  ]
}`;
  }
  if (os === 'linux') {
    return `{
  "name": "com.aria2chrome.reveal",
  "description": "Aria2Chrome reveal",
  "path": "/home/YOUR_USERNAME/.../native_host/reveal-host.sh",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/"
  ]
}`;
  }
  return `{
  "name": "com.aria2chrome.reveal",
  "description": "Aria2Chrome reveal",
  "path": "/Users/YOUR_USERNAME/.../native_host/reveal-host.sh",
  "type": "stdio",
  "allowed_origins": [
    "chrome-extension://YOUR_EXTENSION_ID/"
  ]
}`;
}

function getNativeHostBrowserChoice() {
  return document.querySelector('input[name="nativeHostBrowser"]:checked')?.value === 'edge' ? 'edge' : 'chrome';
}

/**
 * Default install layout: .../Default/Extensions/<extensionId>/<manifestVersion>/native_host/reveal-host.*
 * @param {'macos'|'windows'|'linux'} os
 */
function buildStandardNativeHostRevealPathFor(username, extensionId, browser, os) {
  const u = String(username).replace(/[/\\]/g, '').trim();
  const id = String(extensionId).replace(/\s+/g, '');
  if (!u || !id) return '';
  let ver = '0.0.0';
  try {
    ver = chrome.runtime.getManifest().version || ver;
  } catch (e) {
    /* ignore */
  }
  if (os === 'windows') {
    return browser === 'edge'
      ? `C:\\Users\\${u}\\AppData\\Local\\Microsoft\\Edge\\User Data\\Default\\Extensions\\${id}\\${ver}\\native_host\\reveal-host.bat`
      : `C:\\Users\\${u}\\AppData\\Local\\Google\\Chrome\\User Data\\Default\\Extensions\\${id}\\${ver}\\native_host\\reveal-host.bat`;
  }
  if (os === 'macos') {
    return browser === 'edge'
      ? `/Users/${u}/Library/Application Support/Microsoft Edge/Default/Extensions/${id}/${ver}/native_host/reveal-host.sh`
      : `/Users/${u}/Library/Application Support/Google/Chrome/Default/Extensions/${id}/${ver}/native_host/reveal-host.sh`;
  }
  return browser === 'edge'
    ? `/home/${u}/.config/microsoft-edge/Default/Extensions/${id}/${ver}/native_host/reveal-host.sh`
    : `/home/${u}/.config/google-chrome/Default/Extensions/${id}/${ver}/native_host/reveal-host.sh`;
}

function buildStandardNativeHostRevealPath(username, extensionId, browser) {
  return buildStandardNativeHostRevealPathFor(username, extensionId, browser, getNativeHostOsChoice());
}

/**
 * Full path for com.aria2chrome.reveal.json under NativeMessagingHosts.
 * @param {'macos'|'windows'|'linux'} os
 */
function buildNativeMessagingHostsManifestFilePathFor(username, browser, os) {
  const u = String(username).replace(/[/\\]/g, '').trim();
  if (!u) return '';
  if (os === 'windows') {
    const base =
      browser === 'edge'
        ? `C:\\Users\\${u}\\AppData\\Local\\Microsoft\\Edge\\User Data\\NativeMessagingHosts`
        : `C:\\Users\\${u}\\AppData\\Local\\Google\\Chrome\\User Data\\NativeMessagingHosts`;
    return `${base}\\com.aria2chrome.reveal.json`;
  }
  if (os === 'macos') {
    const base =
      browser === 'edge'
        ? `/Users/${u}/Library/Application Support/Microsoft Edge/NativeMessagingHosts`
        : `/Users/${u}/Library/Application Support/Google/Chrome/NativeMessagingHosts`;
    return `${base}/com.aria2chrome.reveal.json`;
  }
  const base =
    browser === 'edge'
      ? `/home/${u}/.config/microsoft-edge/NativeMessagingHosts`
      : `/home/${u}/.config/google-chrome/NativeMessagingHosts`;
  return `${base}/com.aria2chrome.reveal.json`;
}

function buildNativeMessagingHostsManifestFilePath(username, browser) {
  return buildNativeMessagingHostsManifestFilePathFor(username, browser, getNativeHostOsChoice());
}

function getNativeMessagingHostsManifestFilePath() {
  const { username } = buildNativeHostManifestDraft();
  if (!username) return '';
  return buildNativeMessagingHostsManifestFilePath(username, getNativeHostBrowserChoice());
}

/** Same folder as reveal-host.sh / .bat — bundled Python native-messaging host. */
function getNativeHostPythonHelperPath() {
  const reveal = getEffectiveNativeHostRevealPath();
  if (!reveal) return '';
  const os = getNativeHostOsChoice();
  if (os === 'windows') {
    return reveal.replace(/reveal-host\.bat$/i, 'aria2chrome_native_host.py');
  }
  return reveal.replace(/reveal-host\.sh$/i, 'aria2chrome_native_host.py');
}

function getEffectiveNativeHostRevealPathFor(os) {
  const { username, id } = buildNativeHostManifestDraft();
  if (username && id) {
    return buildStandardNativeHostRevealPathFor(username, id, getNativeHostBrowserChoice(), os);
  }
  return '';
}

function getEffectiveNativeHostRevealPath() {
  return getEffectiveNativeHostRevealPathFor(getNativeHostOsChoice());
}

/**
 * @param {{ allowIncompletePath?: boolean }} [opts]
 */
function buildNativeHostManifestJsonPretty(opts = {}) {
  const allowIncompletePath = opts.allowIncompletePath === true;
  const os = getNativeHostOsChoice();
  const { username, id } = buildNativeHostManifestDraft();
  if (!username || !id) return null;
  const path = getEffectiveNativeHostRevealPathFor(os);
  if (!path && !allowIncompletePath) return null;
  const obj = {
    name: 'com.aria2chrome.reveal',
    description: 'Aria2Chrome reveal',
    path: path || '',
    type: 'stdio',
    allowed_origins: [`chrome-extension://${id}/`]
  };
  return JSON.stringify(obj, null, 2);
}

/** Bash-safe single-quoted literal (paths with spaces, Application Support, etc.). */
function bashSingleQuoted(s) {
  return "'" + String(s).replace(/'/g, "'\"'\"'") + "'";
}

/**
 * One pasteable script: mkdir, write host JSON, chmod launcher + Python helper.
 * @param {'macos'|'linux'} os
 */
function buildNativeHostOneShotBash(os) {
  const browser = getNativeHostBrowserChoice();
  const { username, id } = buildNativeHostManifestDraft();
  if (!String(username || '').trim() || !String(id || '').trim()) {
    return `# Fill "OS username" and "Extension ID" in the section above, then copy again.\n# (${os} script; uses Chrome/Edge choice from the top of this page.)`;
  }
  const manifestPath = buildNativeMessagingHostsManifestFilePathFor(username.trim(), browser, os);
  const reveal = getEffectiveNativeHostRevealPathFor(os);
  const python = reveal.replace(/reveal-host\.sh$/i, 'aria2chrome_native_host.py');
  if (!manifestPath || !reveal) {
    return '# Could not build paths. Set username and Extension ID in Options.';
  }
  const tryResolve = '1';
  const stepComments =
    os === 'linux'
      ? [
          '# --- Same numbered steps as Settings (OS = Linux) ---',
          '# 1. Enter Extension ID in Aria2Chrome Options (top of Local helper section).',
          '# 2. Confirm paths under Files (Chromium vs Chrome if you use Chromium).',
          '# 3. Paste and run this script: picks newest version folder, overwrites host files + manifest (re-run safe).',
          '# 4. Enable "Use installed local helper", Save Settings, reload the extension.',
          '# --- Install ---'
        ]
      : [
          '# --- Same numbered steps as Settings (OS = macOS) ---',
          '# 1. chrome://extensions or edge://extensions — copy Extension ID into Aria2Chrome Options.',
          '# 2. Confirm paths under Files.',
          '# 3. Run this script in Terminal: picks newest version folder, overwrites host files + manifest (re-run safe).',
          '# 4. Enable "Use installed local helper", Save Settings, reload the extension.',
          '# --- Install ---'
        ];
  const jsonViaPython = `JSON=$(python3 <<'PY'
import json, os
e, p = os.environ["EXT_ID"], os.environ["LAUNCHER"]
print(json.dumps({
  "name": "com.aria2chrome.reveal",
  "description": "Aria2Chrome reveal",
  "path": p,
  "type": "stdio",
  "allowed_origins": [f"chrome-extension://{e}/"]
}, indent=2))
PY
)`;
  return [
    '#!/usr/bin/env bash',
    ...stepComments,
    '# Writes native_host launcher + Python host from embedded copies (always overwrites = safe re-run + upgrades),',
    '# then manifest JSON. Picks newest …/Extensions/<id>/<ver>/native_host/ when multiple version dirs exist.',
    '# Requires python3. Stale native_host files in older <ver> folders are removed so Chrome only uses one copy.',
    'set -euo pipefail',
    `MANIFEST=${bashSingleQuoted(manifestPath)}`,
    `LAUNCHER=${bashSingleQuoted(reveal)}`,
    `PYTHON=${bashSingleQuoted(python)}`,
    `ARIA2_TRY_RESOLVE_VERSION=${tryResolve}`,
    'EXT_ID_ROOT="$(dirname "$(dirname "$(dirname "$LAUNCHER")")")"',
    'if [[ "${ARIA2_TRY_RESOLVE_VERSION:-0}" == "1" ]] && [[ -d "$EXT_ID_ROOT" ]]; then',
    '  BEST_LAUNCHER=""',
    '  BEST_MT=0',
    '  for vdir in "$EXT_ID_ROOT"/*; do',
    '    [[ -d "$vdir/native_host" ]] || continue',
    '    MT=$(stat -f%m "$vdir" 2>/dev/null || stat -c%Y "$vdir" 2>/dev/null || echo 0)',
    '    if [[ "$MT" =~ ^[0-9]+$ ]] && [[ "$MT" -ge "$BEST_MT" ]]; then BEST_MT=$MT; BEST_LAUNCHER="$vdir/native_host/reveal-host.sh"; fi',
    '  done',
    '  if [[ -n "$BEST_LAUNCHER" ]]; then',
    '    LAUNCHER="$BEST_LAUNCHER"',
    '    PYTHON="${LAUNCHER%/*}/aria2chrome_native_host.py"',
    '  fi',
    'fi',
    'EXT_ID="$(basename "$EXT_ID_ROOT")"',
    'mkdir -p "$(dirname "$MANIFEST")" "$(dirname "$LAUNCHER")"',
    '# Always re-write embedded payloads (idempotent; picks up Aria2Chrome host changes on re-run).',
    `cat > "$PYTHON" <<'ARIA2HEREDOC_PY'`,
    NATIVE_HOST_PY_EMBED,
    'ARIA2HEREDOC_PY',
    `cat > "$LAUNCHER" <<'ARIA2HEREDOC_SH'`,
    NATIVE_HOST_SH_EMBED,
    'ARIA2HEREDOC_SH',
    'chmod +x "$PYTHON" "$LAUNCHER"',
    '# Remove Aria2Chrome hook files from older …/Extensions/<id>/<ver>/native_host/ after Chrome updates.',
    'BEST_VER_DIR="$(cd "$(dirname "$LAUNCHER")/.." && pwd -P)"',
    'if [[ -d "$EXT_ID_ROOT" ]]; then',
    '  for ov in "$EXT_ID_ROOT"/*; do',
    '    [[ -d "$ov" ]] || continue',
    '    [[ "$(cd "$ov" && pwd -P)" == "$BEST_VER_DIR" ]] && continue',
    '    nh="$ov/native_host"',
    '    [[ -d "$nh" ]] || continue',
    '    rm -f "$nh/reveal-host.sh" "$nh/reveal-host.bat" "$nh/aria2chrome_native_host.py" 2>/dev/null || true',
    '    rmdir "$nh" 2>/dev/null || true',
    '  done',
    'fi',
    'if [[ ! -s "$PYTHON" ]] || [[ ! -s "$LAUNCHER" ]]; then',
    '  echo "Aria2Chrome: ERROR — could not install native_host files." >&2',
    '  echo "  launcher: $LAUNCHER" >&2',
    '  echo "  python:   $PYTHON" >&2',
    '  exit 1',
    'fi',
    'if ! command -v python3 >/dev/null 2>&1; then',
    '  echo "Aria2Chrome: ERROR — python3 not found. Install Python 3." >&2',
    '  exit 1',
    'fi',
    'export EXT_ID LAUNCHER',
    jsonViaPython,
    'printf \'%s\\n\' "$JSON" > "$MANIFEST"',
    'echo ""',
    'echo "Aria2Chrome: done. Manifest written to:"',
    'echo "  $MANIFEST"',
    'echo "Using launcher:"',
    'echo "  $LAUNCHER"',
    'echo "Launcher + Python helper are executable."',
    'echo ""',
    'echo "Press Enter to dismiss (keeps this window open after .command or Run Script)."',
    '# Prefer controlling terminal when stdin is not the TTY (double-click .command, Shortcuts); else wait.',
    'read -r _ </dev/tty 2>/dev/null || read -r _ || sleep 30',
    ''
  ].join('\n');
}

/** PowerShell: write native_host payloads (base64), then UTF-8 manifest. */
function buildNativeHostOneShotPowerShell() {
  const browser = getNativeHostBrowserChoice();
  const { username, id } = buildNativeHostManifestDraft();
  if (!String(username || '').trim() || !String(id || '').trim()) {
    return "# Fill OS username and Extension ID above, then copy again.\n# Uses Chrome/Edge choice from the top of this page.";
  }
  const manifestPath = buildNativeMessagingHostsManifestFilePathFor(username.trim(), browser, 'windows');
  const reveal = getEffectiveNativeHostRevealPathFor('windows');
  if (!manifestPath || !reveal) {
    return '# Could not build paths.';
  }
  const pyPath = reveal.replace(/reveal-host\.bat$/i, 'aria2chrome_native_host.py');
  const pyB64 = typeof btoa === 'function' ? btoa(NATIVE_HOST_PY_EMBED) : '';
  const batB64 = typeof btoa === 'function' ? btoa(NATIVE_HOST_BAT_EMBED) : '';
  const tryResolvePs = '$true';
  return `# --- Same numbered steps as Settings (OS = Windows) ---
# 1. Enter Extension ID in Aria2Chrome Options (top of Local helper section).
# 2. Confirm paths under Files in Options.
# 3. Run this script: resolves newest version folder, overwrites embedded host files + manifest (re-run / upgrade safe).
# 4. Enable "Use installed local helper", Save Settings, reload the extension.
# --- Install ---
$ErrorActionPreference = "Stop"
$TryResolveVersion = ${tryResolvePs}
try {
$Manifest = @'
${manifestPath}
'@
$Launcher = @'
${reveal}
'@
$Python = @'
${pyPath}
'@
$PyB64 = "${pyB64}"
$BatB64 = "${batB64}"
$ExtIdRoot = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $Launcher))
if ($TryResolveVersion -and (Test-Path -LiteralPath $ExtIdRoot)) {
  $bestLauncher = $null
  $bestMt = [DateTime]::MinValue
  Get-ChildItem -LiteralPath $ExtIdRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    $nh = Join-Path $_.FullName "native_host"
    if (-not (Test-Path -LiteralPath $nh -PathType Container)) { return }
    $l = Join-Path $nh "reveal-host.bat"
    if ($_.LastWriteTimeUtc -gt $bestMt) {
      $bestMt = $_.LastWriteTimeUtc
      $bestLauncher = $l
    }
  }
  if ($null -ne $bestLauncher) {
    $Launcher = $bestLauncher
    $Python = Join-Path (Split-Path -LiteralPath $Launcher) "aria2chrome_native_host.py"
  }
}
$Dirs = @(
  (Split-Path -LiteralPath $Manifest),
  (Split-Path -LiteralPath $Launcher)
) | Select-Object -Unique
foreach ($d in $Dirs) { New-Item -ItemType Directory -Force -Path $d | Out-Null }
function Install-Embedded([string]$Path, [string]$B64) {
  [System.IO.File]::WriteAllBytes($Path, [System.Convert]::FromBase64String($B64))
}
Install-Embedded -Path $Python -B64 $PyB64
Install-Embedded -Path $Launcher -B64 $BatB64
$BestVerDir = Split-Path -Parent (Split-Path -LiteralPath $Launcher)
if (Test-Path -LiteralPath $ExtIdRoot) {
  $bestResolved = [System.IO.Path]::GetFullPath($BestVerDir)
  Get-ChildItem -LiteralPath $ExtIdRoot -Directory -ErrorAction SilentlyContinue | ForEach-Object {
    if ([System.IO.Path]::GetFullPath($_.FullName) -eq $bestResolved) { return }
    $nh = Join-Path $_.FullName "native_host"
    if (-not (Test-Path -LiteralPath $nh -PathType Container)) { return }
    foreach ($n in @("reveal-host.bat","reveal-host.sh","aria2chrome_native_host.py")) {
      $fp = Join-Path $nh $n
      if (Test-Path -LiteralPath $fp) { Remove-Item -LiteralPath $fp -Force -ErrorAction SilentlyContinue }
    }
    $left = Get-ChildItem -LiteralPath $nh -ErrorAction SilentlyContinue | Measure-Object | Select-Object -ExpandProperty Count
    if ($left -eq 0) { Remove-Item -LiteralPath $nh -Force -ErrorAction SilentlyContinue }
  }
}
if ((-not (Test-Path -LiteralPath $Python)) -or (-not (Test-Path -LiteralPath $Launcher))) {
  Write-Host "Aria2Chrome: ERROR — could not install native_host files." -ForegroundColor Red
  Write-Host "  launcher: $Launcher"
  Write-Host "  python:   $Python"
  throw "native_host install failed"
}
$pyItem = Get-Item -LiteralPath $Python
$batItem = Get-Item -LiteralPath $Launcher
if (($null -eq $pyItem) -or ($null -eq $batItem) -or ($pyItem.Length -lt 1) -or ($batItem.Length -lt 1)) {
  throw "native_host files empty after install"
}
$ExtId = Split-Path -Leaf -LiteralPath $ExtIdRoot
$NmJson = @{
  name = "com.aria2chrome.reveal"
  description = "Aria2Chrome reveal"
  path = $Launcher
  type = "stdio"
  allowed_origins = @("chrome-extension://$ExtId/")
}
$Json = $NmJson | ConvertTo-Json -Depth 6
Set-Content -LiteralPath $Manifest -Value $Json -Encoding utf8
  Write-Host ""
  Write-Host "Aria2Chrome: done. Native messaging manifest written to:" -ForegroundColor Green
  Write-Host "  $Manifest"
  Write-Host "Using launcher:"
  Write-Host "  $Launcher"
} catch {
  Write-Host ""
  Write-Host "Aria2Chrome: error — $_" -ForegroundColor Red
} finally {
  Read-Host "Press Enter to exit (keeps this window open)"
}
`;
}

function updateNativeHostOneShotBlocks() {
  const pre = document.getElementById('nativeHostOneShot');
  if (!pre) return;
  const os = getNativeHostOsChoice();
  if (os === 'windows') pre.textContent = buildNativeHostOneShotPowerShell();
  else if (os === 'linux') pre.textContent = buildNativeHostOneShotBash('linux');
  else pre.textContent = buildNativeHostOneShotBash('macos');
}

async function persistNativeHostManifestDraft() {
  const { username, id } = buildNativeHostManifestDraft();
  if (!username && !id) {
    await chrome.storage.sync.remove([
      'nativeHostManifestUsername',
      'nativeHostManifestExtensionId',
      'nativeHostManifestRevealPath'
    ]);
    return;
  }
  await chrome.storage.sync.set({
    nativeHostManifestUsername: username,
    nativeHostManifestExtensionId: id,
    nativeHostManifestOs: getNativeHostOsChoice()
  });
  await chrome.storage.sync.remove(['nativeHostManifestRevealPath']);
}

function updateNativeHostManifestPreview() {
  const pre = document.getElementById('nativeHostManifestPreview');
  if (!pre) return;
  const { username, id } = buildNativeHostManifestDraft();
  if (!username || !id) {
    pre.textContent = getNativeHostPlaceholderPreviewText();
    pre.classList.add('native-host-manifest-preview--placeholder');
    return;
  }
  pre.classList.remove('native-host-manifest-preview--placeholder');
  const json = buildNativeHostManifestJsonPretty({ allowIncompletePath: true });
  pre.textContent = json || '';
}

let _nativeHostFeedbackTimer = null;
function flashNativeHostFeedback(elementId, message, isError) {
  const el = document.getElementById(elementId);
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('is-error', !!isError);
  clearTimeout(_nativeHostFeedbackTimer);
  _nativeHostFeedbackTimer = setTimeout(() => {
    el.textContent = '';
  }, 3500);
}

function updateNativeHostLauncherFileLabel() {
  const name = getNativeHostOsChoice() === 'windows' ? 'reveal-host.bat' : 'reveal-host.sh';
  document.querySelectorAll('[data-native-host-launcher-filename]').forEach((el) => {
    el.textContent = name;
  });
}

function updateNativeHostResolvedPathDisplay() {
  updateNativeHostLauncherFileLabel();

  const manifestInput = document.getElementById('nativeHostManifestFilePath');
  const manifestPath = getNativeMessagingHostsManifestFilePath();
  if (manifestInput) {
    if (!manifestPath) {
      manifestInput.value = '';
      manifestInput.placeholder = '(Enter OS username and extension ID above)';
    } else {
      manifestInput.value = manifestPath;
      manifestInput.placeholder = '';
    }
  }

  const input = document.getElementById('nativeHostResolvedPath');
  if (input) {
    const effective = getEffectiveNativeHostRevealPath();
    if (!effective) {
      input.value = '';
      input.placeholder = '(Enter OS username and extension ID above)';
    } else {
      input.value = effective;
      input.placeholder = '';
    }
  }

  const pyInput = document.getElementById('nativeHostPythonPath');
  const pyPath = getNativeHostPythonHelperPath();
  if (pyInput) {
    if (!pyPath) {
      pyInput.value = '';
      pyInput.placeholder = '(Enter OS username and extension ID above)';
    } else {
      pyInput.value = pyPath;
      pyInput.placeholder = '';
    }
  }

  updateNativeHostLauncherPreview();
  updateNativeHostPythonPreview();
}

function updateNativeHostLauncherPreview() {
  const pre = document.getElementById('nativeHostLauncherPreview');
  if (!pre) return;
  pre.textContent =
    getNativeHostOsChoice() === 'windows' ? NATIVE_HOST_BAT_EMBED.trimEnd() : NATIVE_HOST_SH_EMBED.trimEnd();
}

function updateNativeHostPythonPreview() {
  const pre = document.getElementById('nativeHostPythonPreview');
  if (!pre) return;
  pre.textContent = NATIVE_HOST_PY_EMBED.trimEnd();
}

function updateNativeHostLayout() {
  const edge = document.querySelector('input[name="nativeHostBrowser"]:checked')?.value === 'edge';
  document.querySelectorAll('.path-chrome').forEach((el) => {
    el.hidden = edge;
  });
  document.querySelectorAll('.path-edge').forEach((el) => {
    el.hidden = !edge;
  });
  updateNativeHostResolvedPathDisplay();
  updateNativeHostManifestPreview();
  updateNativeHostOneShotBlocks();
}

async function copyNativeHostOneshot() {
  const pre = document.getElementById('nativeHostOneShot');
  if (!pre || !pre.textContent.trim()) {
    flashNativeHostFeedback('nativeHostCopyOneshotFb', 'Nothing to copy.', true);
    return;
  }
  try {
    await navigator.clipboard.writeText(pre.textContent.replace(/\r\n/g, '\n'));
    flashNativeHostFeedback('nativeHostCopyOneshotFb', 'Copied.', false);
  } catch (e) {
    flashNativeHostFeedback('nativeHostCopyOneshotFb', 'Copy failed.', true);
  }
}

async function copyNativeHostStaticPathField(btn) {
  const row = btn && btn.closest('.copyable-field-row');
  if (!row) return;
  const inputs = row.querySelectorAll('input.copyable-field-input');
  let text = '';
  inputs.forEach((inp) => {
    if (!inp.hidden) text = inp.value;
  });
  if (!text && inputs.length === 1) text = inputs[0].value;
  if (!text) return;
  try {
    await navigator.clipboard.writeText(text);
    const label = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = label || 'Copy';
    }, 1600);
  } catch (e) {
    showSaveStatus('Copy failed.', 'error');
  }
}

async function copyNativeHostTextareaField(btn) {
  const row = btn && btn.closest('.copyable-field-row');
  const ta = row && row.querySelector('textarea.copyable-textarea');
  if (!ta) return;
  try {
    await navigator.clipboard.writeText(ta.value.replace(/\r\n/g, '\n'));
    const label = btn.textContent;
    btn.textContent = 'Copied!';
    setTimeout(() => {
      btn.textContent = label || 'Copy';
    }, 1600);
  } catch (e) {
    showSaveStatus('Copy failed.', 'error');
  }
}

// Render extension checkboxes
function renderExtensions() {
  renderExtensionCategory('videoExtensions', FILE_EXTENSIONS.video);
  renderExtensionCategory('audioExtensions', FILE_EXTENSIONS.audio);
  renderExtensionCategory('archiveExtensions', FILE_EXTENSIONS.archive);
  renderExtensionCategory('diskExtensions', FILE_EXTENSIONS.disk);
  renderCustomExtensions();
}

// Render a category of extensions
function renderExtensionCategory(containerId, extensions) {
  const container = document.getElementById(containerId);
  container.innerHTML = '';
  
  extensions.forEach(ext => {
    const item = createExtensionCheckbox(ext, false);
    container.appendChild(item);
  });
}

// Render custom extensions
function renderCustomExtensions() {
  const container = document.getElementById('customExtensions');
  container.innerHTML = '';
  
  customExtensions.forEach(ext => {
    const item = createExtensionCheckbox(ext, true);
    container.appendChild(item);
  });
}

// Create extension checkbox element
function createExtensionCheckbox(ext, isCustom = false) {
  const item = document.createElement('div');
  item.className = 'extension-item' + (isCustom ? ' custom' : '');
  
  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.id = 'ext_' + ext.replace(/\./g, '_');
  checkbox.value = ext;
  checkbox.checked = selectedExtensions.includes(ext);
  checkbox.addEventListener('change', handleExtensionChange);
  
  const label = document.createElement('label');
  label.htmlFor = checkbox.id;
  label.textContent = ext;
  
  item.appendChild(checkbox);
  item.appendChild(label);
  
  // Add remove button for custom extensions
  if (isCustom) {
    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.textContent = '×';
    removeBtn.title = 'Remove';
    removeBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      removeCustomExtension(ext);
    });
    item.appendChild(removeBtn);
  }
  
  // Make entire item clickable
  item.addEventListener('click', (e) => {
    if (e.target !== checkbox && e.target.className !== 'remove-btn') {
      checkbox.checked = !checkbox.checked;
      handleExtensionChange({ target: checkbox });
    }
  });
  
  return item;
}

// Handle extension checkbox change
function handleExtensionChange(event) {
  const ext = event.target.value;
  
  if (event.target.checked) {
    if (!selectedExtensions.includes(ext)) {
      selectedExtensions.push(ext);
    }
  } else {
    selectedExtensions = selectedExtensions.filter(e => e !== ext);
  }
}

// Add custom extension
function addCustomExtension() {
  const input = document.getElementById('customExtension');
  let ext = input.value.trim().toLowerCase();
  
  if (!ext) return;
  
  // Ensure extension starts with dot
  if (!ext.startsWith('.')) {
    ext = '.' + ext;
  }
  
  // Validate extension format
  if (!/^\.[a-z0-9]+$/.test(ext)) {
    showSaveStatus('Invalid extension format. Use only letters and numbers.', 'error');
    return;
  }
  
  // Check if already exists
  const allExtensions = [
    ...FILE_EXTENSIONS.video,
    ...FILE_EXTENSIONS.audio,
    ...FILE_EXTENSIONS.archive,
    ...FILE_EXTENSIONS.disk,
    ...customExtensions
  ];
  
  if (allExtensions.includes(ext)) {
    showSaveStatus('Extension already exists.', 'error');
    return;
  }
  
  // Add to custom extensions
  customExtensions.push(ext);
  selectedExtensions.push(ext);
  
  // Clear input
  input.value = '';
  
  // Re-render custom extensions
  renderCustomExtensions();
  
  showSaveStatus('Custom extension added. Click Save to apply.', 'success');
}

// Remove custom extension
function removeCustomExtension(ext) {
  customExtensions = customExtensions.filter(e => e !== ext);
  selectedExtensions = selectedExtensions.filter(e => e !== ext);
  renderCustomExtensions();
  showSaveStatus('Custom extension removed. Click Save to apply.', 'success');
}

// Select all extensions
function selectAll() {
  selectedExtensions = [
    ...FILE_EXTENSIONS.video,
    ...FILE_EXTENSIONS.audio,
    ...FILE_EXTENSIONS.archive,
    ...FILE_EXTENSIONS.disk,
    ...customExtensions
  ];
  renderExtensions();
}

// Deselect all extensions
function deselectAll() {
  selectedExtensions = [];
  renderExtensions();
}

// Reset extensions to defaults
function resetExtensions() {
  if (confirm('Reset to default video file extensions only?')) {
    selectedExtensions = [...DEFAULT_EXTENSIONS];
    customExtensions = [];
    renderExtensions();
    showSaveStatus('Extensions reset to defaults. Click Save to apply.', 'success');
  }
}

// Save settings
async function saveSettings() {
  const config = {
    rpcUrl: document.getElementById('rpcUrl').value.trim() || 'http://localhost:6800/jsonrpc',
    secret: document.getElementById('secret').value.trim(),
    downloadDir: document.getElementById('downloadDir').value.trim()
  };
  const autoResumeValue = document.getElementById('autoResume').checked;
  const showNotificationsValue = document.getElementById('showNotifications').checked;
  const perDl = {
    split: clampInt(document.getElementById('aria2Split')?.value, 1, 32),
    minSplitSize: document.getElementById('aria2MinSplitSize')?.value.trim() || '1M',
    maxConnectionPerServer: clampInt(document.getElementById('aria2MaxConnPerServer')?.value, 1, 32)
  };
  const localDetails = document.getElementById('section-local-helper');
  
  try {
    await chrome.storage.sync.set({ 
      aria2Config: config,
      fileExtensions: selectedExtensions,
      customFileExtensions: customExtensions,
      autoResume: autoResumeValue,
      showNotifications: showNotificationsValue,
      nativeRevealEnabled: document.getElementById('nativeRevealEnabled').checked,
      maxConcurrentDownloads: clampInt(document.getElementById('maxConcurrentDownloads')?.value, 1, 32),
      aria2PerDownloadOpts: perDl,
      maxOverallDownloadLimit: document.getElementById('maxOverallDownloadLimit')?.value.trim() ?? '',
      syncAria2GlobalLimits: document.getElementById('syncAria2GlobalLimits')?.checked !== false,
      siteInterceptDenyHosts: parseHostLines(document.getElementById('siteInterceptDenyHosts')?.value),
      siteInterceptAllowHosts: parseHostLines(document.getElementById('siteInterceptAllowHosts')?.value),
      optionsTheme: document.getElementById('optionsTheme')?.value || 'system',
      localHelperDetailsOpen: localDetails ? !!localDetails.open : false
    });
    await persistNativeHostManifestDraft();
    await chrome.storage.sync.set({ nativeHostManifestOs: getNativeHostOsChoice() });
    
    await sendMessagePromise({ action: 'updateConfig', config });
    const glob = await sendMessagePromise({ action: 'applyAria2GlobalLimits' });
    if (glob && glob.applied === false && glob.reason === 'sync_disabled') {
      showSaveStatus('Settings saved (aria2 global limits not synced — disabled).', 'success');
    } else if (glob && glob.error) {
      showSaveStatus('Settings saved; aria2 global limits: ' + glob.error, 'success');
    } else {
      showSaveStatus('Settings saved successfully!', 'success');
    }
    
    chrome.runtime.sendMessage({ 
      action: 'updatePreferences', 
      preferences: { showNotifications: showNotificationsValue }
    });
  } catch (error) {
    showSaveStatus('Failed to save settings: ' + error.message, 'error');
  }
}

// Export backup
function exportBackup() {
  chrome.runtime.sendMessage({ action: 'exportBackup' }, response => {
    if (response && response.success) {
      showSaveStatus(`✅ Backup exported: ${response.filename}`, 'success');
    } else {
      showSaveStatus(`❌ Export failed: ${response?.error || 'Unknown error'}`, 'error');
    }
  });
}

// Import backup
function importBackup() {
  const fileInput = document.getElementById('importFile');
  fileInput.click();
}

// Handle file selection
function handleFileSelect(event) {
  const file = event.target.files[0];
  if (!file) return;
  
  const reader = new FileReader();
  reader.onload = (e) => {
    try {
      const backupData = JSON.parse(e.target.result);
      chrome.runtime.sendMessage({ 
        action: 'importBackup',
        backupData: backupData
      }, response => {
        if (response && response.success) {
          showSaveStatus('✅ Backup imported successfully! Reloading settings...', 'success');
          setTimeout(() => {
            location.reload();
          }, 1500);
        } else {
          showSaveStatus(`❌ Import failed: ${response?.error || 'Unknown error'}`, 'error');
        }
      });
    } catch (error) {
      showSaveStatus(`❌ Invalid backup file: ${error.message}`, 'error');
    }
  };
  reader.readAsText(file);
  
  // Reset file input
  event.target.value = '';
}

// Reset to defaults
function resetSettings() {
  if (confirm('Are you sure you want to reset all settings to defaults?')) {
    document.getElementById('rpcUrl').value = 'http://localhost:6800/jsonrpc';
    document.getElementById('secret').value = '';
    document.getElementById('downloadDir').value = DEFAULT_DOWNLOAD_DIR_HINT;
    document.getElementById('autoResume').checked = true;
    document.getElementById('showNotifications').checked = true;
    document.getElementById('nativeRevealEnabled').checked = false;
    const nu = document.getElementById('nativeHostUsername');
    const nid = document.getElementById('nativeHostExtensionId');
    if (nu) nu.value = '';
    if (nid) nid.value = '';
    setNativeHostOsChoice(detectNativeHostOs(), { skipLayout: true });
    updateNativeHostLayout();
    chrome.storage.sync.remove([
      'nativeHostManifestUsername',
      'nativeHostManifestExtensionId',
      'nativeHostManifestRevealPath',
      'nativeHostManifestOs'
    ]);
    
    selectedExtensions = [...DEFAULT_EXTENSIONS];
    customExtensions = [];
    renderExtensions();

    const mc = document.getElementById('maxConcurrentDownloads');
    if (mc) mc.value = '5';
    const splitEl = document.getElementById('aria2Split');
    const minSplitEl = document.getElementById('aria2MinSplitSize');
    const mcsEl = document.getElementById('aria2MaxConnPerServer');
    if (splitEl) splitEl.value = '16';
    if (minSplitEl) minSplitEl.value = '1M';
    if (mcsEl) mcsEl.value = '16';
    const mol = document.getElementById('maxOverallDownloadLimit');
    if (mol) mol.value = '';
    const syncGlob = document.getElementById('syncAria2GlobalLimits');
    if (syncGlob) syncGlob.checked = true;
    const denyTa = document.getElementById('siteInterceptDenyHosts');
    const allowTa = document.getElementById('siteInterceptAllowHosts');
    if (denyTa) denyTa.value = '';
    if (allowTa) allowTa.value = '';
    const themeSel = document.getElementById('optionsTheme');
    if (themeSel) {
      themeSel.value = 'system';
      applyOptionsTheme('system');
    }
    const localDetails = document.getElementById('section-local-helper');
    if (localDetails) localDetails.open = false;
    
    showSaveStatus('Settings reset to defaults. Click Save to apply.', 'success');
  }
}

async function copyDownloadDirPath() {
  const el = document.getElementById('downloadDir');
  if (!el) return;
  try {
    await navigator.clipboard.writeText(el.value || '');
    showSaveStatus('Download path copied.', 'success');
  } catch (e) {
    showSaveStatus('Copy failed.', 'error');
  }
}

function applyTypicalLocalAria2Preset() {
  const os = detectNativeHostOs();
  const userEl = document.getElementById('nativeHostUsername');
  const user = (userEl && userEl.value.trim()) || 'USERNAME';
  const rpc = document.getElementById('rpcUrl');
  const dir = document.getElementById('downloadDir');
  if (rpc) rpc.value = 'http://localhost:6800/jsonrpc';
  if (!dir) return;
  if (os === 'windows') {
    dir.value = `C:\\Users\\${user}\\Downloads`;
  } else if (os === 'macos') {
    dir.value = `/Users/${user}/Downloads`;
  } else {
    dir.value = `/home/${user}/Downloads`;
  }
  showSaveStatus('Filled typical local RPC URL and download folder. Review and Save.', 'success');
}

async function runDiagnostics() {
  const pre = document.getElementById('diagnosticsOutput');
  if (!pre) return;
  pre.hidden = false;
  pre.textContent = 'Running…';
  try {
    const d = await sendMessagePromise({ action: 'getDiagnostics' });
    pre.textContent = JSON.stringify(d, null, 2);
  } catch (e) {
    pre.textContent = 'Error: ' + (e && e.message ? e.message : String(e));
  }
}

// Test connection
async function testConnection() {
  const rpcUrl = document.getElementById('rpcUrl').value.trim() || 'http://localhost:6800/jsonrpc';
  const secret = document.getElementById('secret').value.trim();
  
  const payload = {
    jsonrpc: '2.0',
    id: 'test',
    method: 'aria2.getVersion',
    params: secret ? [`token:${secret}`] : []
  };
  
  showTestResult('Testing connection...', 'success');
  
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload)
    });
    
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    
    const data = await response.json();
    
    if (data.error) {
      throw new Error(data.error.message || 'Aria2 RPC error');
    }
    
    const version = data.result.version;
    showTestResult(`✅ Connection successful! Aria2 version: ${version}`, 'success');
  } catch (error) {
    showTestResult(`❌ Connection failed: ${error.message}`, 'error');
  }
}

// Show save status
function showSaveStatus(message, type) {
  const statusEl = document.getElementById('saveStatus');
  statusEl.textContent = message;
  statusEl.className = 'save-status ' + type;
  statusEl.style.display = 'block';
  
  setTimeout(() => {
    statusEl.style.display = 'none';
  }, 5000);
}

// Show test result
function showTestResult(message, type) {
  const resultEl = document.getElementById('testResult');
  resultEl.textContent = message;
  resultEl.className = 'test-result ' + type;
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadSettings();

  document.querySelectorAll('input[name="nativeHostBrowser"]').forEach((radio) => {
    radio.addEventListener('change', updateNativeHostLayout);
  });
  document.querySelectorAll('.native-host-os-tab').forEach((btn) => {
    btn.addEventListener('click', () => {
      const os = btn.getAttribute('data-native-host-os');
      if (!os) return;
      setNativeHostOsChoice(os);
      void chrome.storage.sync.set({ nativeHostManifestOs: getNativeHostOsChoice() });
    });
  });
  document.querySelectorAll('.copy-static-path-btn').forEach((btn) => {
    btn.addEventListener('click', () => copyNativeHostStaticPathField(btn));
  });
  document.querySelectorAll('.copy-textarea-btn').forEach((btn) => {
    btn.addEventListener('click', () => copyNativeHostTextareaField(btn));
  });
  document.getElementById('copyNativeHostOneshotBtn')?.addEventListener('click', () => {
    void copyNativeHostOneshot();
  });
  ['nativeHostUsername', 'nativeHostExtensionId'].forEach((fieldId) => {
    const el = document.getElementById(fieldId);
    if (!el) return;
    el.addEventListener('input', updateNativeHostLayout);
    el.addEventListener('blur', () => {
      void persistNativeHostManifestDraft();
    });
  });
  
  // Event listeners
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('resetBtn').addEventListener('click', resetSettings);
  document.getElementById('testBtn').addEventListener('click', testConnection);
  document.getElementById('diagnosticsBtn')?.addEventListener('click', () => void runDiagnostics());
  document.getElementById('copyDownloadDirBtn')?.addEventListener('click', () => void copyDownloadDirPath());
  document.getElementById('typicalLocalAria2Btn')?.addEventListener('click', applyTypicalLocalAria2Preset);
  document.getElementById('optionsTheme')?.addEventListener('change', (e) => {
    applyOptionsTheme(e.target.value);
    void chrome.storage.sync.set({ optionsTheme: e.target.value });
  });
  document.getElementById('addCustomBtn').addEventListener('click', addCustomExtension);
  document.getElementById('customExtension').addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
      addCustomExtension();
    }
  });
  document.getElementById('selectAllBtn').addEventListener('click', selectAll);
  document.getElementById('deselectAllBtn').addEventListener('click', deselectAll);
  document.getElementById('resetExtensionsBtn').addEventListener('click', resetExtensions);
  document.getElementById('exportBtn').addEventListener('click', exportBackup);
  document.getElementById('importBtn').addEventListener('click', importBackup);
  document.getElementById('importFile').addEventListener('change', handleFileSelect);
});
