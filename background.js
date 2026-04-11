// Background service worker for aria2 RPC communication

// Import browser polyfill for Firefox compatibility
try {
  importScripts('browser-polyfill.js');
} catch (e) {
  // Polyfill already loaded or not needed in Chrome
}

let aria2Config = {
  rpcUrl: 'http://localhost:6800/jsonrpc',
  secret: '',
  downloadDir: ''
};

let downloads = {}; // Track downloads by gid
let downloadQueue = []; // Queue for pending downloads
let pollingInterval = null;
let lastBadgeText = '';
let lastTooltipText = '';
let backupInterval = null;
let interceptionEnabled = true; // Track if download interception is enabled
let ignoreNextDownloads = new Set(); // Track downloads to ignore (prevent loops)
const directoryIndexTabs = new Map(); // Track tabs that expose HTTP directory listings
const DIRECTORY_CONTEXT_MENU_ID = 'aria2chrome-download-directory';
const LINK_CONTEXT_MENU_ID = 'aria2chrome-download-link';
let showNotifications = true;
const BACKUP_FILENAME = '.aria2-downloader-backup.json';
const MAX_CONCURRENT_DOWNLOADS = 5;
const MAX_RETRY_ATTEMPTS = 3;
const RETRY_DELAYS = [5000, 15000, 60000]; // 5s, 15s, 60s (exponential backoff)
const LOG_STORAGE_KEY = 'aria2Logs';
const MAX_LOG_ENTRIES = 500;
let logBuffer = null;

// onDeterminingFilename must use the same extension set as the options page (sync).
// Default matches options.js when the user has never saved: video only.
const DEFAULT_INTERCEPT_EXTENSIONS = [
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg',
  '.3gp', '.ogv', '.ts', '.m3u8', '.f4v', '.vob', '.rm', '.rmvb', '.divx', '.xvid', '.m2ts', '.mts', '.asf'
];
let cachedInterceptExtensions = [...DEFAULT_INTERCEPT_EXTENSIONS];

async function refreshInterceptExtensionsCache() {
  try {
    const result = await chrome.storage.sync.get(['fileExtensions', 'customFileExtensions']);
    const base =
      result.fileExtensions && result.fileExtensions.length > 0
        ? result.fileExtensions
        : DEFAULT_INTERCEPT_EXTENSIONS;
    const custom = Array.isArray(result.customFileExtensions) ? result.customFileExtensions : [];
    const merged = [...base];
    const seen = new Set(base.map((e) => (e || '').toLowerCase()));
    custom.forEach((e) => {
      const raw = (e || '').trim();
      if (!raw) return;
      const withDot = raw.startsWith('.') ? raw : `.${raw}`;
      const low = withDot.toLowerCase();
      if (!seen.has(low)) {
        seen.add(low);
        merged.push(withDot);
      }
    });
    cachedInterceptExtensions = merged;
  } catch (e) {
    console.warn('[Aria2 Downloader] refreshInterceptExtensionsCache failed:', e);
  }
}

// Forced ignore list - these downloads are NEVER intercepted
const FORCED_IGNORE_LIST = {
  urlPatterns: [
    /^data:/i,           // Data URLs (backups, exports)
    /^blob:/i,           // Blob URLs (generated files)
    /^chrome-extension:\/\//i,  // Extension URLs
    /^file:\/\//i,       // Local file URLs
    // Note: Removed gofile.io, mega.nz, mediafire - now handled with cookies!
    
    // File hosting service pages (not direct downloads)
    // These show filename in URL but aren't actual download links
    /rapidgator\.net\/file\//i,
    /nitroflare\.com\/view\//i,
    /uploadgig\.com\/file\/download\//i,
    /multiup\.io\/download\//i,
    /1fichier\.com\/\?/i,
    /turbobit\.net\//i,
    /uploaded\.net\/file\//i,
    /filefactory\.com\/file\//i
  ],
  filenamePatterns: [
    /aria2-downloader-backup/i,  // Our backup files
    /\.json$/i,          // All JSON files (to be safe)
    /\.html$/i,          // HTML files (file hosting pages)
    /\.htm$/i            // HTM files (file hosting pages)
  ]
};

// Check if download should be ignored
function shouldIgnoreDownload(url, filename) {
  // Check URL patterns
  for (const pattern of FORCED_IGNORE_LIST.urlPatterns) {
    if (pattern.test(url)) {
      console.log('[Aria2 Downloader] Ignoring download - URL pattern match:', pattern);
      return true;
    }
  }
  
  // Check filename patterns
  if (filename) {
    for (const pattern of FORCED_IGNORE_LIST.filenamePatterns) {
      if (pattern.test(filename)) {
    logInfo('Ignoring download due to filename pattern', { filename, pattern: pattern.toString() });
        return true;
      }
    }
  }
  
  return false;
}

// ----- Persistent Logging -----

async function loadLogBuffer() {
  if (logBuffer !== null) {
    return logBuffer;
  }
  
  try {
    const result = await chrome.storage.local.get([LOG_STORAGE_KEY]);
    logBuffer = result[LOG_STORAGE_KEY] || [];
  } catch (error) {
    console.warn('[Aria2 Downloader] Failed to load logs from storage:', error);
    logBuffer = [];
  }
  
  return logBuffer;
}

async function appendLog(level, message, context = {}) {
  try {
    const logs = await loadLogBuffer();
    const entry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      context
    };
    
    logs.push(entry);
    
    if (logs.length > MAX_LOG_ENTRIES) {
      logs.splice(0, logs.length - MAX_LOG_ENTRIES);
    }
    
    await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logs });
  } catch (error) {
    console.warn('[Aria2 Downloader] Failed to append log entry:', error);
  }
}

async function clearLogs() {
  logBuffer = [];
  try {
    await chrome.storage.local.set({ [LOG_STORAGE_KEY]: logBuffer });
  } catch (error) {
    console.warn('[Aria2 Downloader] Failed to clear logs:', error);
  }
}

function logInfo(message, context) {
  console.log('[Aria2 Downloader]', message, context || '');
  appendLog('info', message, context || {});
}

function logError(message, context) {
  console.error('[Aria2 Downloader]', message, context || '');
  appendLog('error', message, context || {});
}

function createNotification(options) {
  if (!showNotifications) return;
  chrome.notifications.create(options);
}

function getFilenameFromUrl(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').filter(Boolean).pop();
    if (filename) {
      return decodeURIComponent(filename);
    }
  } catch (e) {
    // ignore
  }
  return 'download_' + Date.now();
}

// ----- Context Menu Helpers -----

function setupContextMenus() {
  if (!chrome.contextMenus) {
    return;
  }
  
  chrome.contextMenus.removeAll(() => {
    const err = chrome.runtime.lastError;
    if (err && !err.message.includes('No context menus to remove')) {
      console.warn('[Aria2 Downloader] contextMenus.removeAll warning:', err.message);
    }
    
    chrome.contextMenus.create({
      id: DIRECTORY_CONTEXT_MENU_ID,
      title: 'Aria2Chrome: Download all files in directory',
      contexts: ['page'],
      visible: false
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[Aria2 Downloader] Failed to create context menu:', chrome.runtime.lastError.message);
      } else {
        console.log('[Aria2 Downloader] Context menu created');
      }
    });
    
    chrome.contextMenus.create({
      id: LINK_CONTEXT_MENU_ID,
      title: 'Aria2Chrome: Download this link',
      contexts: ['link']
    }, () => {
      if (chrome.runtime.lastError) {
        console.warn('[Aria2 Downloader] Failed to create link context menu:', chrome.runtime.lastError.message);
      }
    });
  });
}

function updateDirectoryContextMenu(tabId) {
  if (!chrome.contextMenus) return;
  
  const entry = tabId !== undefined ? directoryIndexTabs.get(tabId) : null;
  const visible = !!entry;
  const baseTitle = 'Aria2Chrome: Download all files in directory';
  const title = entry && entry.fileCount ? `${baseTitle} (${entry.fileCount})` : baseTitle;
  
  chrome.contextMenus.update(DIRECTORY_CONTEXT_MENU_ID, { visible, title }, () => {
    const err = chrome.runtime.lastError;
    if (err && err.message.includes('Cannot find menu item')) {
      // Menu might not exist yet (service worker just restarted) - recreate
      setupContextMenus();
    }
  });
}

function recordDirectoryListingStatus(tabId, hasListing, fileCount = 0) {
  if (tabId === undefined || tabId === null) {
    return;
  }
  
  if (hasListing && fileCount > 0) {
    directoryIndexTabs.set(tabId, { fileCount });
  } else {
    directoryIndexTabs.delete(tabId);
  }
  
  updateDirectoryContextMenu(tabId);
}

async function handleLinkContextDownload(info, tab) {
  const url = info.linkUrl;
  const filename = getFilenameFromUrl(url);
  const metadata = {
    pageUrl: info.pageUrl || tab?.url || '',
    pageTitle: tab?.title || '',
    isContextMenu: true
  };
  
  const chosenFilename = await promptFilenameFromTab(tab?.id, filename);
  if (chosenFilename === null) {
    logInfo('Context menu download cancelled by user', { url, filename });
    return;
  }
  
  const finalName = chosenFilename || filename;
  
  const result = await addDownload(url, finalName, metadata, true);
  if (!result.success && !result.duplicate && !result.awaiting_confirmation) {
    createNotification({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Aria2Chrome',
      message: result.error || 'Failed to add download'
    });
  } else if (result.awaiting_confirmation) {
    createNotification({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Aria2Chrome',
      message: `${finalName} ready - open popup to confirm and start`
    });
  }
}

async function promptFilenameFromTab(tabId, suggestedName) {
  if (!tabId || !chrome.tabs || !chrome.tabs.sendMessage) {
    return suggestedName;
  }
  
  return await new Promise(resolve => {
    chrome.tabs.sendMessage(tabId, {
      action: 'promptFilenameForDownload',
      suggestedName,
      allowFilePicker: true
    }, response => {
      if (chrome.runtime.lastError) {
        console.warn('[Aria2 Downloader] Could not prompt filename in tab:', chrome.runtime.lastError.message);
        resolve(suggestedName);
        return;
      }
      
      if (!response) {
        resolve(suggestedName);
        return;
      }
      
      if (response.success && response.filename) {
        resolve(response.filename);
      } else if (response.cancelled) {
        resolve(null);
      } else {
        resolve(suggestedName);
      }
    });
  });
}

// Initialize context menus on service worker load
setupContextMenus();

if (chrome.contextMenus) {
  if (chrome.contextMenus.onShown && chrome.contextMenus.onShown.addListener) {
    chrome.contextMenus.onShown.addListener((info, tab) => {
      if (!tab) return;
      updateDirectoryContextMenu(tab.id);
      if (chrome.contextMenus.refresh) {
        chrome.contextMenus.refresh();
      }
    });
  }
  
  if (chrome.contextMenus.onClicked && chrome.contextMenus.onClicked.addListener) {
    chrome.contextMenus.onClicked.addListener((info, tab) => {
      if (info.menuItemId === DIRECTORY_CONTEXT_MENU_ID) {
        if (!tab || tab.id === undefined || !chrome.tabs || !chrome.tabs.sendMessage) {
          return;
        }
        
        chrome.tabs.sendMessage(tab.id, { action: 'triggerDirectoryDownloadAll' }, response => {
          const err = chrome.runtime.lastError;
          if (err) {
            console.warn('[Aria2 Downloader] Failed to notify content script for directory download:', err.message);
            createNotification({
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: 'Aria2Chrome',
              message: 'Could not access this page to download all files. Try reloading.'
            });
          }
        });
      } else if (info.menuItemId === LINK_CONTEXT_MENU_ID) {
        if (!info.linkUrl) {
          return;
        }
        handleLinkContextDownload(info, tab);
      }
    });
  }
}

if (chrome.tabs && chrome.tabs.onRemoved) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    directoryIndexTabs.delete(tabId);
  });
}

// Load configuration on startup
chrome.runtime.onInstalled.addListener(async (details) => {
  // Check install reason
  if (details.reason === 'install') {
    logInfo('Extension installed - attempting to restore from backup');
    await restoreFromBackup();
    try {
      chrome.runtime.openOptionsPage();
      logInfo('Options page opened for initial setup');
    } catch (error) {
      logError('Failed to open options page on install', { error: error.message });
    }
  } else if (details.reason === 'update') {
    logInfo('Extension updated - attempting to restore from backup');
    await restoreFromBackup();
  }
  
  await loadConfig();
  startPolling();
  startBackupSchedule();
  setupContextMenus();
  
  // Show welcome notification on first install
  if (details.reason === 'install') {
    createNotification({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Aria2Chrome Installed',
      message: 'Configure your aria2 RPC settings to get started!'
    });
  }
});

chrome.runtime.onStartup.addListener(async () => {
  await restoreFromBackup();
  await loadConfig();
  startPolling();
  startBackupSchedule();
  setupContextMenus();
});

// Backup before extension unloads (uninstall, disable, or update)
chrome.runtime.onSuspend.addListener(async () => {
  console.log('[Aria2 Downloader] Extension suspending - performing final backup');
  await performBackup();
});

// Load configuration from storage
async function loadConfig() {
  const result = await chrome.storage.sync.get(['aria2Config', 'interceptionEnabled', 'showNotifications']);
  if (result.aria2Config) {
    aria2Config = { ...aria2Config, ...result.aria2Config };
  }
  if (result.interceptionEnabled !== undefined) {
    interceptionEnabled = result.interceptionEnabled;
  }
  if (result.showNotifications !== undefined) {
    showNotifications = result.showNotifications;
  }
  
  logInfo('Aria2 config loaded', {
    rpcUrl: aria2Config.rpcUrl,
    downloadDir: aria2Config.downloadDir,
    interceptionEnabled,
    showNotifications
  });
  
  // Update badge based on interception state
  updateBadgeColor();

  await refreshInterceptExtensionsCache();
}

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== 'sync') return;
  if (changes.fileExtensions || changes.customFileExtensions) {
    refreshInterceptExtensionsCache();
  }
});

// Save configuration to storage
async function saveConfig() {
  await chrome.storage.sync.set({ aria2Config });
  // Backup after config changes
  await saveBackupToStorage();
  logInfo('Aria2 config saved', {
    rpcUrl: aria2Config.rpcUrl,
    downloadDir: aria2Config.downloadDir
  });
}

// Aria2 RPC call wrapper
async function aria2RPC(method, params = []) {
  const payload = {
    jsonrpc: '2.0',
    id: Date.now().toString(),
    method: method,
    params: aria2Config.secret ? [`token:${aria2Config.secret}`, ...params] : params
  };
  
  try {
    const response = await fetch(aria2Config.rpcUrl, {
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
    
    return data.result;
  } catch (error) {
    // Provide more helpful error messages
    if (error.message.includes('Failed to fetch') || error.name === 'TypeError') {
      throw new Error('aria2c is not running or not accessible at ' + aria2Config.rpcUrl);
    }
    throw error;
  }
}

// Get cookies for a URL
async function getCookiesForUrl(url) {
  try {
    const urlObj = new URL(url);
    const cookies = await chrome.cookies.getAll({ url: url });
    
    if (cookies.length === 0) {
      return null;
    }
    
    // Format cookies as HTTP Cookie header
    const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
    return cookieString;
  } catch (error) {
    console.error('[Aria2 Downloader] Failed to get cookies:', error);
    return null;
  }
}

// Count active downloads
function getActiveDownloadCount() {
  return Object.values(downloads).filter(d => 
    d.status === 'active' || d.status === 'waiting'
  ).length;
}

// Check if download already exists (prevent duplicates)
function isDuplicateDownload(url, filename) {
  const downloadsArray = Object.values(downloads);
  
  // Check for active/waiting/queued downloads with same URL or filename
  const activeDuplicate = downloadsArray.find(d => 
    (d.url === url || d.filename === filename) && 
    (d.status === 'active' || d.status === 'waiting' || d.status === 'queued')
  );
  
  if (activeDuplicate) {
    return true;
  }
  
  // Check for paused/failed downloads with same filename (different URL = fresh link!)
  const pausedDuplicate = downloadsArray.find(d => 
    d.filename === filename && 
    (d.status === 'paused' || d.status === 'error' || d.status === 'failed_permanently')
  );
  
  if (pausedDuplicate && pausedDuplicate.url !== url) {
    const progress = Math.floor(calculateProgress(pausedDuplicate));
    console.log('[Aria2 Downloader] Found existing incomplete download for:', filename);
    console.log('[Aria2 Downloader] Existing:', pausedDuplicate.completedLength, '/', pausedDuplicate.totalLength, `(${progress}%)`);
    console.log('[Aria2 Downloader] New URL detected - this appears to be a fresh link for the same file!');
    
    // Automatically update the URL and resume immediately (links expire quickly!)
    pausedDuplicate.url = url;
    pausedDuplicate.retryCount = 0;
    pausedDuplicate.lastRetryTime = 0;
    pausedDuplicate.status = 'paused'; // Will be set to active when resumed
    
    saveDownloads();
    
    // Auto-resume immediately to prevent link expiration
    console.log('[Aria2 Downloader] Auto-resuming immediately to prevent link expiration');
    
    // Resume asynchronously - don't wait for it
    (async () => {
      const resumeResult = await resumeDownload(pausedDuplicate.gid);
      
      if (resumeResult.success) {
        createNotification({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Download Auto-Resumed!',
          message: `${filename} (${progress}% complete) has been resumed with a fresh URL!`,
          priority: 2
        });
        console.log('[Aria2 Downloader] ✓ Auto-resume successful for:', filename);
      } else {
        createNotification({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Download Link Updated',
          message: `${filename} URL updated but auto-resume failed. Click Resume to try again.`,
          priority: 1
        });
        console.log('[Aria2 Downloader] ✗ Auto-resume failed:', resumeResult.error);
      }
    })();
    
    // Prevent creating duplicate - we updated the existing one instead
    return true;
  }
  
  return false;
}

// Add download to aria2 or queue
async function addDownload(url, filename, metadata = {}, skipConfirmation = false) {
  // Don't add if interception is disabled
  if (!interceptionEnabled) {
    logInfo('Interception disabled, skipping download', { url, filename });
    return { success: false, error: 'Download interception is disabled' };
  }

  const configuredDir = (aria2Config.downloadDir || '').trim();
  if (!configuredDir) {
    const errorMessage = 'Download directory is not configured. Open Aria2Chrome settings and enter an absolute path like /home/you/Downloads.';
    logError('Missing download directory configuration', { url, filename });
    return { success: false, error: errorMessage };
  }
  
  // Check for duplicates
  if (isDuplicateDownload(url, filename)) {
    logInfo('Duplicate download detected, skipping', { url, filename });
    return { success: false, error: 'Download already exists', duplicate: true };
  }
  
  // Check if we're at max capacity
  const activeCount = getActiveDownloadCount();
  if (activeCount >= MAX_CONCURRENT_DOWNLOADS) {
    // Add to queue instead
    const queueId = 'queue_' + Date.now() + '_' + Math.random().toString(36).substring(7);
    const queuedDownload = {
      queueId,
      url,
      filename,
      status: 'queued',
      ...metadata,
      addedAt: Date.now(),
      skipConfirmation
    };
    
    downloadQueue.push(queuedDownload);
    downloads[queueId] = queuedDownload;
    await saveDownloads();
    
    logInfo('Download queued (max concurrent reached)', {
      filename,
      url,
      queueLength: downloadQueue.length
    });
    return { success: true, queued: true, queueId };
  }
  
  // Start download immediately (with confirmation if needed)
  return await startDownload(url, filename, metadata, skipConfirmation);
}

// Expand ~ in path (aria2c might not handle it properly in some cases)
function expandPath(path) {
  if (!path) return path;
  
  // For paths starting with ~/, we can't reliably expand without knowing user's home
  // But we can let aria2c handle it by keeping it as-is
  // The issue is likely that we need to remove the trailing slash
  
  // Remove trailing slashes
  return path.replace(/\/+$/, '');
}

// Actually start a download in aria2c
async function startDownload(url, filename, metadata = {}, skipConfirmation = false) {
  try {
    // Reload config to get latest download directory
    await loadConfig();
    const configuredDir = (aria2Config.downloadDir || '').trim();
    
    // Prompt for filename confirmation if not skipped
    if (!skipConfirmation) {
      // Store download info for confirmation
      const confirmationId = 'confirm_' + Date.now() + '_' + Math.random().toString(36).substring(7);
      downloads[confirmationId] = {
        confirmationId,
        url,
        filename,
        status: 'awaiting_confirmation',
        ...metadata,
        addedAt: Date.now()
      };
      await saveDownloads();
      
      logInfo('Download awaiting filename confirmation', { filename, url });
      return { success: true, awaiting_confirmation: true, confirmationId };
    }
    
    // Only use aria2c for downloading - no duplicate Chrome download
    const options = {
      out: filename,
      // Enable automatic resume if file exists
      continue: 'true',
      // Allow overwrite to resume existing partial downloads
      'allow-overwrite': 'true',
      // Max connection per server for faster downloads
      'max-connection-per-server': '16',
      // Split file into 16 chunks
      split: '16',
      // Minimum split size (1MB)
      'min-split-size': '1M'
    };
    
    if (configuredDir) {
      // Expand and clean the path
      options.dir = expandPath(configuredDir);
      logInfo('Setting download directory for download', { dir: options.dir, filename });
    } else {
      logInfo('Using aria2 default download directory', { filename });
    }
    
    // Get FRESH cookies for this URL (critical for authenticated sites)
    const cookies = await getCookiesForUrl(url);
    const headers = [];
    
    if (cookies) {
      headers.push(`Cookie: ${cookies}`);
      logInfo('Attaching cookies for download', { hostname: new URL(url).hostname });
    }
    
    // Add comprehensive browser headers to simulate a real browser request
    headers.push('User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    headers.push('Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/avif,*/*;q=0.8');
    headers.push('Accept-Language: en-US,en;q=0.9');
    headers.push('Accept-Encoding: gzip, deflate, br');
    headers.push('DNT: 1');
    headers.push('Connection: keep-alive');
    headers.push('Upgrade-Insecure-Requests: 1');
    headers.push('Sec-Fetch-Dest: document');
    headers.push('Sec-Fetch-Mode: navigate');
    headers.push('Sec-Fetch-Site: cross-site');
    headers.push('Sec-Fetch-User: ?1');
    headers.push('Cache-Control: max-age=0');
    
    // Use page URL as referer (important for referrer-checking sites)
    if (metadata.pageUrl) {
      headers.push(`Referer: ${metadata.pageUrl}`);
    }
    
    options.header = headers;
    
    logInfo('Submitting aria2.addUri request', {
      filename,
      url,
      dir: options.dir || 'aria2-default'
    });
    
    const gid = await aria2RPC('aria2.addUri', [[url], options]);
    
    logInfo('Download added to aria2', { filename, gid });
    
    // Store download information
    downloads[gid] = {
      gid,
      url,
      filename,
      status: 'active',
      ...metadata,
      addedAt: Date.now(),
      retryCount: 0,
      lastRetryTime: 0
    };
    
    await saveDownloads();
    
    return { success: true, gid };
  } catch (error) {
    logError('Failed to add download to aria2', { filename, url, error: error.message });
    // Show user-facing notification for download failures
    createNotification({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Download Failed',
      message: `Failed to add ${filename}: ${error.message}`
    });
    
    return { success: false, error: error.message };
  }
}

// Process queue - start next download if capacity available
async function processQueue() {
  const activeCount = getActiveDownloadCount();
  
  if (activeCount < MAX_CONCURRENT_DOWNLOADS && downloadQueue.length > 0) {
    // Get most recent queued download (LIFO - Last In First Out)
    const queuedDownload = downloadQueue.pop();
    
    logInfo('Auto-starting queued download', {
      filename: queuedDownload.filename,
      queueRemaining: downloadQueue.length
    });
    
    // Remove from downloads (will be re-added when started)
    delete downloads[queuedDownload.queueId];
    
    // Start the download (preserve skipConfirmation flag)
    const result = await startDownload(
      queuedDownload.url, 
      queuedDownload.filename, 
      {
        pageUrl: queuedDownload.pageUrl,
        pageTitle: queuedDownload.pageTitle
      },
      queuedDownload.skipConfirmation || false
    );
    
    await saveDownloads();
    return result;
  }
  
  return null;
}

// Manually start a queued download
async function startQueuedDownloadManually(queueId) {
  try {
    // Find the queued download
    const queuedDownload = downloads[queueId];
    if (!queuedDownload || queuedDownload.status !== 'queued') {
      return { success: false, error: 'Download not found in queue' };
    }
    
    // Remove from queue array
    const queueIndex = downloadQueue.findIndex(d => d.queueId === queueId);
    if (queueIndex !== -1) {
      downloadQueue.splice(queueIndex, 1);
    }
    
    // Remove from downloads (will be re-added when started)
    delete downloads[queueId];
    
    logInfo('Manually starting queued download', {
      filename: queuedDownload.filename,
      queueId
    });
    
    // Start the download (preserve skipConfirmation flag)
    const result = await startDownload(
      queuedDownload.url,
      queuedDownload.filename,
      {
        pageUrl: queuedDownload.pageUrl,
        pageTitle: queuedDownload.pageTitle
      },
      queuedDownload.skipConfirmation || false
    );
    
    await saveDownloads();
    return result;
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Get download status
async function getDownloadStatus(gid) {
  try {
    // aria2.tellStatus works for all downloads (active, waiting, paused, stopped)
    const status = await aria2RPC('aria2.tellStatus', [gid]);
    console.log('[Aria2 Downloader] Download status for gid', gid + ':', status.status);
    return status;
  } catch (error) {
    // Download not found in aria2c (removed from memory)
    console.log('[Aria2 Downloader] Download not found in aria2c with gid:', gid, error.message);
    return null;
  }
}

// Smart retry with exponential backoff and max attempts
async function smartRetry(gid) {
  try {
    const download = downloads[gid];
    if (!download) {
      return { success: false, error: 'Download not found' };
    }
    
    // Initialize retry count if not present
    if (download.retryCount === undefined) {
      download.retryCount = 0;
      download.lastRetryTime = 0;
    }
    
    // Check if exceeded max retries
    if (download.retryCount >= MAX_RETRY_ATTEMPTS) {
      console.log('[Aria2 Downloader] Max retry attempts reached for:', download.filename);
      
      // Only mark as failed_permanently if not already (prevents spam)
      if (download.status !== 'failed_permanently') {
        download.status = 'failed_permanently';
        await saveDownloads();
        
        // Show notification once when hitting max retries
        createNotification({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Download Failed',
          message: `${download.filename} failed after ${MAX_RETRY_ATTEMPTS} attempts. Click Resume to try again.`,
          priority: 1
        });
      }
      
      return { success: false, error: 'Max retry attempts exceeded' };
    }
    
    // Check if enough time has passed since last retry (exponential backoff)
    const now = Date.now();
    const retryDelay = RETRY_DELAYS[Math.min(download.retryCount, RETRY_DELAYS.length - 1)];
    const timeSinceLastRetry = now - download.lastRetryTime;
    
    if (download.lastRetryTime > 0 && timeSinceLastRetry < retryDelay) {
      // Not enough time passed, skip this retry
      const remainingWait = Math.ceil((retryDelay - timeSinceLastRetry) / 1000);
      console.log(`[Aria2 Downloader] Waiting ${remainingWait}s before retry ${download.retryCount + 1}`);
      return { success: false, error: 'Waiting for retry delay' };
    }
    
    // Increment retry count
    download.retryCount++;
    download.lastRetryTime = now;
    await saveDownloads();
    
    console.log(`[Aria2 Downloader] Retry attempt ${download.retryCount}/${MAX_RETRY_ATTEMPTS} for:`, download.filename);
    
    // Attempt resume (automatic, not manual)
    return await resumeDownload(gid, false);
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Resume incomplete download (NEVER creates new entry, only retries existing)
// manualResume: true = user clicked resume button, false = automatic retry from polling
async function resumeDownload(gid, manualResume = true) {
  try {
    const download = downloads[gid];
    if (!download) {
      throw new Error('Download not found in tracking');
    }
    
    if (download.renameRequiresRestart) {
      if (!manualResume) {
        return { success: false, error: 'Rename pending - manual resume required' };
      }
      const restartResult = await restartDownloadAfterRename(download);
      return restartResult;
    }
    
    // If it's already complete, just return success
    if (download.status === 'complete') {
      return { success: true, message: 'Download already complete' };
    }
    
    // Only reset retry count for MANUAL resume (allow user unlimited manual retries)
    // This ensures the resume button ALWAYS works, even for failed_permanently
    const wasFailedPermanently = download.status === 'failed_permanently';
    if (manualResume) {
      console.log('[Aria2 Downloader] Manual resume requested - resetting retry counter');
      download.retryCount = 0;
      download.lastRetryTime = 0;
    }
    
    // Reset status from failed_permanently to allow retry
    if (download.status === 'failed_permanently' || download.status === 'error') {
      console.log('[Aria2 Downloader] Resetting status from', download.status, 'to paused');
      download.status = 'paused';
    }
    
    await saveDownloads();
    
    // Show notification for failed_permanently retries
    if (wasFailedPermanently) {
      createNotification({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Retry Attempts Reset',
        message: `Retrying ${download.filename} - retry counter has been reset`
      });
    }
    
    // Check if download is actually 100% complete (false failure)
    console.log('[Aria2 Downloader] Checking if download is complete:', {
      filename: download.filename,
      completedLength: download.completedLength,
      totalLength: download.totalLength,
      progress: calculateProgress(download)
    });
    
    const progress = calculateProgress(download);
    const completed = parseInt(download.completedLength || 0);
    const total = parseInt(download.totalLength || 0);
    
    // CRITICAL: Only mark as complete if EXACTLY 100% - byte-perfect match!
    // If even 1 byte is missing, we must resume to get it
    // Use strict equality check (===) not >= to prevent false completion
    const isComplete = download.completedLength && download.totalLength && 
                       completed === total && progress === 100;
    
    if (isComplete) {
      // File is fully downloaded, mark as complete
      console.log('[Aria2 Downloader] Manual resume: File is exactly 100% complete, marking as complete:', download.filename);
      download.status = 'complete';
      
      // Clean up .aria2 control file
      try {
        await aria2RPC('aria2.removeDownloadResult', [gid]);
        console.log('[Aria2 Downloader] Cleaned up aria2 control file for:', download.filename);
      } catch (e) {
        console.log('[Aria2 Downloader] Could not clean up aria2 file (might not exist):', e.message);
      }
      
      await saveDownloads();
      
      createNotification({
        type: 'basic',
        iconUrl: 'icons/icon48.png',
        title: 'Download Complete',
        message: `${download.filename} is complete (100% downloaded)`
      });
      
      return { success: true, message: 'Download is complete' };
    } else {
      console.log('[Aria2 Downloader] Download is NOT complete, attempting resume');
    }
    
    // Prevent auto-resume from creating duplicates
    if (download.resuming) {
      console.log('[Aria2 Downloader] Already attempting to resume, skipping');
      return { success: false, message: 'Resume already in progress' };
    }
    
    download.resuming = true;
    
    const status = await getDownloadStatus(gid);
    
    if (!status) {
      // Download not in aria2 - re-add it using EXISTING entry
      console.log('[Aria2 Downloader] Download not found in aria2, re-adding with same entry');
      
      try {
        // Re-add to aria2c using existing download data
        const options = {
          out: download.filename,
          // Force aria2c to continue from existing file (resume mode)
          continue: 'true',
          // Allow overwrite to resume existing partial file
          'allow-overwrite': 'true'
        };
        
        if (aria2Config.downloadDir) {
          options.dir = expandPath(aria2Config.downloadDir);
        }
        
        // Get FRESH cookies from browser (critical for expired sessions)
        const cookies = await getCookiesForUrl(download.url);
        const headers = [];
        
        if (cookies) {
          headers.push(`Cookie: ${cookies}`);
          console.log('[Aria2 Downloader] Using fresh cookies from browser for resume');
        }
        
        // Add browser headers to make it look like a fresh browser request
        headers.push('User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        headers.push('Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/avif,*/*;q=0.8');
        headers.push('Accept-Language: en-US,en;q=0.9');
        headers.push('Accept-Encoding: gzip, deflate, br');
        headers.push('DNT: 1');
        headers.push('Connection: keep-alive');
        headers.push('Upgrade-Insecure-Requests: 1');
        headers.push('Sec-Fetch-Dest: document');
        headers.push('Sec-Fetch-Mode: navigate');
        headers.push('Sec-Fetch-Site: none');
        headers.push('Sec-Fetch-User: ?1');
        headers.push('Cache-Control: max-age=0');
        
        // Use page URL as referer if available (important for some sites)
        if (download.pageUrl) {
          headers.push(`Referer: ${download.pageUrl}`);
        }
        
        options.header = headers;
        
        console.log('[Aria2 Downloader] Resume attempt with fresh browser session simulation');
        
        // Re-add to aria2c - get NEW gid
        const newGid = await aria2RPC('aria2.addUri', [[download.url], options]);
        
        // Update the SAME download entry with new gid
        const oldGid = download.gid;
        download.gid = newGid;
        download.status = 'active';
        download.resuming = false;
        
        // Move download from old gid to new gid in downloads object
        delete downloads[oldGid];
        downloads[newGid] = download;
        
        await saveDownloads();
        
        console.log('[Aria2 Downloader] Re-added download with new gid:', newGid, '(old:', oldGid + ')');
        
        // Show success notification
        createNotification({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Download Resumed',
          message: `${download.filename} resumed from ${Math.floor(calculateProgress(download))}%`
        });
        
        return { success: true, message: 'Download re-added and resumed' };
      } catch (error) {
        download.resuming = false;
        console.error('[Aria2 Downloader] Failed to re-add download:', error);
        console.error('[Aria2 Downloader] Download details:', {
          url: download.url,
          filename: download.filename,
          dir: aria2Config.downloadDir
        });
        return { success: false, error: 'Failed to re-add download: ' + error.message };
      }
    }
    
    download.resuming = false;
    
    if (status.status === 'paused') {
      try {
        await aria2RPC('aria2.unpause', [gid]);
        return { success: true, message: 'Download resumed' };
      } catch (e) {
        console.error('[Aria2 Downloader] Failed to unpause download:', e);
        return { success: false, error: 'Failed to resume: ' + e.message };
      }
    } else if (status.status === 'error') {
      // Downloads in error state cannot be unpaused
      // Only attempt full recovery (remove & re-add) on MANUAL resume
      if (!manualResume) {
        // Automatic retry - just report the error, don't try to recover
        console.log('[Aria2 Downloader] Download in error state (automatic retry) - not recovering');
        download.resuming = false;
        return { success: false, error: 'Download in error state - manual resume required' };
      }
      
      // Manual resume - attempt full recovery
      console.log('[Aria2 Downloader] Download in error state (manual resume), removing and re-adding with fresh session');
      
      // Mark as resuming to prevent race conditions
      download.resuming = true;
      
      try {
        // Remove the errored download from aria2
        try {
          await aria2RPC('aria2.remove', [gid]);
        } catch (e) {
          // If remove fails, try removeDownloadResult
          try {
            await aria2RPC('aria2.removeDownloadResult', [gid]);
          } catch (e2) {
            // Ignore - download might already be removed
          }
        }
        
        // Re-add with fresh cookies and headers
        const options = {
          out: download.filename,
          continue: 'true',
          'allow-overwrite': 'true',
          'max-connection-per-server': '16',
          split: '16',
          'min-split-size': '1M'
        };
        
        if (aria2Config.downloadDir) {
          options.dir = expandPath(aria2Config.downloadDir);
        }
        
        // Get FRESH cookies from browser
        const cookies = await getCookiesForUrl(download.url);
        const headers = [];
        
        if (cookies) {
          headers.push(`Cookie: ${cookies}`);
          console.log('[Aria2 Downloader] Using fresh cookies from browser for error recovery');
        }
        
        // Add browser headers
        headers.push('User-Agent: Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
        headers.push('Accept: text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,image/avif,*/*;q=0.8');
        headers.push('Accept-Language: en-US,en;q=0.9');
        headers.push('Accept-Encoding: gzip, deflate, br');
        headers.push('DNT: 1');
        headers.push('Connection: keep-alive');
        headers.push('Upgrade-Insecure-Requests: 1');
        headers.push('Sec-Fetch-Dest: document');
        headers.push('Sec-Fetch-Mode: navigate');
        headers.push('Sec-Fetch-Site: none');
        headers.push('Sec-Fetch-User: ?1');
        headers.push('Cache-Control: max-age=0');
        
        if (download.pageUrl) {
          headers.push(`Referer: ${download.pageUrl}`);
        }
        
        options.header = headers;
        
        console.log('[Aria2 Downloader] Re-adding errored download with fresh session');
        
        // Re-add to aria2c with NEW gid
        const newGid = await aria2RPC('aria2.addUri', [[download.url], options]);
        
        // Update the SAME download entry with new gid
        const oldGid = download.gid;
        download.gid = newGid;
        download.status = 'active';
        download.resuming = false;
        
        // Move download from old gid to new gid
        delete downloads[oldGid];
        downloads[newGid] = download;
        
        await saveDownloads();
        
        console.log('[Aria2 Downloader] Successfully recovered from error state with new gid:', newGid, '(old:', oldGid + ')');
        
        createNotification({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Download Recovered',
          message: `${download.filename} recovered from error and resumed!`
        });
        
        return { success: true, message: 'Download recovered from error' };
      } catch (error) {
        download.resuming = false;
        console.error('[Aria2 Downloader] Failed to recover from error:', error);
        return { success: false, error: 'Failed to recover from error: ' + error.message };
      }
    }
    
    return { success: true, message: 'Download is active' };
  } catch (error) {
    // Clear resuming flag on error
    if (downloads[gid]) {
      downloads[gid].resuming = false;
    }
    return { success: false, error: error.message };
  }
}

// Pause download
async function pauseDownload(gid) {
  try {
    // First check if the download exists and is in a pausable state
    const download = downloads[gid];
    if (!download) {
      return { success: false, error: 'Download not found in tracking' };
    }
    
    // Check if already in a terminal or non-pausable state
    if (download.status === 'complete') {
      return { success: false, error: 'Download is already complete' };
    }
    if (download.status === 'paused') {
      return { success: true, message: 'Download is already paused' };
    }
    if (download.status === 'error' || download.status === 'failed_permanently') {
      return { success: false, error: 'Download is in error state - use Resume to retry' };
    }
    if (download.status === 'queued') {
      // For queued downloads, just mark as paused in our tracking (not in aria2 yet)
      download.status = 'paused';
      await saveDownloads();
      return { success: true, message: 'Queued download paused' };
    }
    if (download.status === 'awaiting_confirmation') {
      return { success: false, error: 'Download is awaiting confirmation - use Remove to cancel' };
    }
    
    // Try to get status from aria2 first
    const status = await getDownloadStatus(gid);
    
    if (!status) {
      // Download not in aria2 - mark as paused in our tracking
      download.status = 'paused';
      await saveDownloads();
      return { success: true, message: 'Download marked as paused (not active in aria2)' };
    }
    
    // Check aria2 status
    if (status.status === 'complete') {
      download.status = 'complete';
      await saveDownloads();
      return { success: false, error: 'Download is already complete' };
    }
    if (status.status === 'paused') {
      download.status = 'paused';
      await saveDownloads();
      return { success: true, message: 'Download is already paused' };
    }
    if (status.status === 'error') {
      download.status = 'error';
      await saveDownloads();
      return { success: false, error: 'Download is in error state - use Resume to retry' };
    }
    
    // Now attempt to pause
    await aria2RPC('aria2.pause', [gid]);
    download.status = 'paused';
    await saveDownloads();
    return { success: true };
  } catch (error) {
    // Handle specific aria2 errors
    const errorMsg = error.message || 'Unknown error';
    
    // aria2 returns specific error messages for invalid operations
    if (errorMsg.includes('is not found') || errorMsg.includes('GID') && errorMsg.includes('not found')) {
      // Download was removed from aria2
      const download = downloads[gid];
      if (download) {
        download.status = 'paused';
        await saveDownloads();
      }
      return { success: true, message: 'Download marked as paused (no longer in aria2)' };
    }
    
    if (errorMsg.includes('cannot be paused') || errorMsg.includes('HTTP error! status: 400')) {
      // Check our tracking to give a more helpful message
      const download = downloads[gid];
      if (download) {
        if (download.status === 'complete') {
          return { success: false, error: 'Download is already complete' };
        }
        // Mark as paused anyway since aria2 can't pause it
        download.status = 'paused';
        await saveDownloads();
        return { success: true, message: 'Download state updated' };
      }
    }
    
    return { success: false, error: errorMsg };
  }
}

// Remove download
async function removeDownload(gid) {
  try {
    // Try to remove from aria2 (works for active downloads)
    try {
      await aria2RPC('aria2.remove', [gid]);
    } catch (e) {
      // If it fails, try removing from stopped downloads
      try {
        await aria2RPC('aria2.removeDownloadResult', [gid]);
      } catch (e2) {
        // Download might already be gone from aria2, that's ok
      }
    }
    
    // Remove from our tracking
    delete downloads[gid];
    await saveDownloads();
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Get all active downloads
async function getAllActiveDownloads() {
  try {
    const active = await aria2RPC('aria2.tellActive');
    const waiting = await aria2RPC('aria2.tellWaiting', [0, 100]);
    const stopped = await aria2RPC('aria2.tellStopped', [0, 100]);
    
    return [...active, ...waiting, ...stopped];
  } catch (error) {
    // Silently return empty array when aria2c is not running
    return [];
  }
}

// Update downloads status
async function updateDownloadsStatus() {
  try {
    const allDownloads = await getAllActiveDownloads();
    
    for (const download of allDownloads) {
      if (downloads[download.gid]) {
        const previousStatus = downloads[download.gid].status;
        
        // Don't overwrite failed_permanently status with error status
        // This prevents retry spam for permanently failed downloads
        if (previousStatus !== 'failed_permanently') {
          downloads[download.gid].status = download.status;
        }
        
        downloads[download.gid].totalLength = download.totalLength;
        downloads[download.gid].completedLength = download.completedLength;
        downloads[download.gid].downloadSpeed = download.downloadSpeed;
        
        // Store file path for completed downloads
        if (download.files && download.files.length > 0) {
          downloads[download.gid].filePath = download.files[0].path;
        }
        
        // Check if download completed
        if (download.status === 'complete' && previousStatus !== 'complete') {
          if (download.files && download.files.length > 0) {
            downloads[download.gid].filePath = download.files[0].path;
          }
          createNotification({
            type: 'basic',
            iconUrl: 'icons/icon48.png',
            title: 'Download Complete',
            message: `${downloads[download.gid].filename} completed`
          });
          
          // Process queue - start next download if available
          await processQueue();
        }
        
        // Smart auto-resume with retry limits
        if (download.status === 'error') {
          // Skip auto-retry if already failed permanently (but manual resume still works)
          if (downloads[download.gid].status === 'failed_permanently') {
            continue; // Skip this download, already at max retries
          }
          
          // Check if download is actually complete (100% downloaded but marked as error)
          const progress = calculateProgress(downloads[download.gid]);
          const completed = parseInt(download.completedLength || 0);
          const total = parseInt(download.totalLength || 0);
          
          // CRITICAL: Only mark as complete if EXACTLY 100% - byte-perfect match!
          // If even 1 byte is missing (99.99%), we must resume to get it
          // Use strict equality check (===) not >= to prevent false completion
          const isComplete = download.completedLength && download.totalLength && 
                             completed === total && progress === 100;
          
          if (isComplete) {
            // File is fully downloaded, just mark as complete
            console.log('[Aria2 Downloader] Download is 100% complete despite error status, marking as complete:', download.filename);
            downloads[download.gid].status = 'complete';
            
            // Clean up .aria2 control file
            try {
              await aria2RPC('aria2.removeDownloadResult', [download.gid]);
              console.log('[Aria2 Downloader] Cleaned up aria2 control file for:', download.filename);
            } catch (e) {
              // Ignore errors - file might already be cleaned up
            }
            
            await saveDownloads();
            
            // Show notification
            createNotification({
              type: 'basic',
              iconUrl: 'icons/icon48.png',
              title: 'Download Complete',
              message: `${downloads[download.gid].filename} completed (file is fully downloaded)`
            });
            
            // Process queue
            await processQueue();
          } else {
            // Actually failed, try smart retry
            await smartRetry(download.gid);
          }
        }
      }
    }
    
    await saveDownloads();
    
    // Update badge with active download count
    updateBadge();
  } catch (error) {
    // Silently handle errors when aria2c is not available
    // This prevents console spam when aria2c is not running
  }
}

// Update badge color based on interception state
function updateBadgeColor() {
  if (!interceptionEnabled) {
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Red when disabled
  } else {
    chrome.action.setBadgeBackgroundColor({ color: '#667eea' }); // Purple when enabled
  }
}

// Update extension badge with download count and tooltip
function updateBadge() {
  const downloadsArray = Object.values(downloads);
  const activeDownloads = downloadsArray.filter(d => 
    d.status === 'active' || d.status === 'waiting'
  );
  const queuedDownloads = downloadsArray.filter(d => d.status === 'queued');
  const activeCount = activeDownloads.length;
  const queuedCount = queuedDownloads.length;
  const totalCount = activeCount + queuedCount;
  
  // Always show badge if there are active or queued downloads
  if (totalCount > 0) {
    const badgeText = activeCount.toString();
    
    // Only update badge text if it changed
    if (badgeText !== lastBadgeText) {
      chrome.action.setBadgeText({ text: badgeText });
      updateBadgeColor();
      lastBadgeText = badgeText;
    }
    
    // Create simple tooltip showing active/total ratio
    const tooltipText = queuedCount > 0 
      ? `Aria2Chrome - ${activeCount}/${totalCount} downloads in progress`
      : `Aria2Chrome - ${activeCount} download${activeCount === 1 ? '' : 's'} in progress`;
    
    // Only update tooltip if it changed (prevents flashing while hovering)
    if (tooltipText !== lastTooltipText) {
      chrome.action.setTitle({ title: tooltipText });
      lastTooltipText = tooltipText;
    }
  } else {
    const badgeText = '';
    const tooltipText = 'Aria2Chrome - No active downloads';
    
    // Only update if changed
    if (badgeText !== lastBadgeText) {
      chrome.action.setBadgeText({ text: badgeText });
      lastBadgeText = badgeText;
    }
    
    if (tooltipText !== lastTooltipText) {
      chrome.action.setTitle({ title: tooltipText });
      lastTooltipText = tooltipText;
    }
  }
}

// Helper function to format speed
function formatSpeed(bytesPerSecond) {
  return formatBytes(bytesPerSecond) + '/s';
}

// Helper function to format bytes
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Helper function to calculate progress
function calculateProgress(download) {
  if (!download || !download.totalLength || download.totalLength === '0') return 0;
  const completed = parseInt(download.completedLength || 0);
  const total = parseInt(download.totalLength);
  // Calculate EXACT percentage - don't round up or cap at 100
  const exactProgress = (completed / total) * 100;
  // Round to 4 decimal places for maximum precision (e.g., 99.9456%)
  // This ensures we never show 100% unless it's EXACTLY 100%
  return Math.floor(exactProgress * 10000) / 10000;
}

// Start polling for download updates
function startPolling() {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
  
  pollingInterval = setInterval(async () => {
    await updateDownloadsStatus();
  }, 2000); // Poll every 2 seconds
  
  // Initial badge update
  updateBadge();
}

// Save downloads to storage
async function saveDownloads() {
  await chrome.storage.local.set({ downloads });
  // Backup after downloads change (but don't spam - debounced by interval)
}

// Load downloads from storage
async function loadDownloads() {
  const result = await chrome.storage.local.get(['downloads']);
  if (result.downloads) {
    downloads = result.downloads;
  }
}

// Clear all history (completed and failed downloads only)
async function clearHistory() {
  const downloadsArray = Object.values(downloads);
  let clearedCount = 0;
  
  // Remove only completed, error, and removed status downloads
  // Keep active, paused, and waiting downloads
  for (const download of downloadsArray) {
    if (download.status === 'complete' || download.status === 'error' || download.status === 'removed') {
      delete downloads[download.gid];
      clearedCount++;
    }
  }
  
  await saveDownloads();
  console.log(`[Aria2 Downloader] Cleared ${clearedCount} downloads from history`);
  
  return clearedCount;
}

// Show file in folder (cross-platform: macOS Finder, Windows Explorer, Linux file managers)
async function showFileInFolder(filepath) {
  try {
    // Find the download with this filepath
    const download = Object.values(downloads).find(d => d.filePath === filepath);
    
    if (!download) {
      return { success: false, error: 'Download not found' };
    }
    
    // Method 1: Try using saved Chrome download ID
    if (download.chromeDownloadId) {
      try {
        // This works cross-platform (macOS Finder, Windows Explorer, Linux Nautilus/Dolphin)
        chrome.downloads.show(download.chromeDownloadId);
        return { success: true };
      } catch (e) {
        console.log('Chrome download ID invalid, trying other methods...');
      }
    }
    
    // Method 2: Search Chrome downloads history
    const filename = download.filename;
    if (filename) {
      try {
        // Search Chrome downloads for this file
        const chromeDownloads = await chrome.downloads.search({ 
          filenameRegex: filename.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), // Escape special chars
          exists: true,
          limit: 20,
          orderBy: ['-startTime']
        });
        
        // Try to find exact match
        let matchingDownload = chromeDownloads.find(d => 
          d.filename && d.filename.endsWith(filename)
        );
        
        // If exact match not found, try partial match
        if (!matchingDownload && chromeDownloads.length > 0) {
          matchingDownload = chromeDownloads.find(d => 
            d.filename && d.filename.toLowerCase().includes(filename.toLowerCase())
          );
        }
        
        if (matchingDownload) {
          chrome.downloads.show(matchingDownload.id);
          // Save the chrome download ID for future use
          download.chromeDownloadId = matchingDownload.id;
          await saveDownloads();
          return { success: true };
        }
      } catch (e) {
        console.log('Chrome downloads search failed:', e);
      }
    }
    
    // Method 3: Try to create a fake download to register the file location
    if (filepath) {
      try {
        // Get directory path and filename
        const parts = filepath.split(/[/\\]/);
        const file = parts.pop();
        const directory = parts.join('/');
        
        // Create a minimal file download to register it with Chrome
        // This will allow chrome.downloads.show() to work
        const downloadId = await new Promise((resolve, reject) => {
          chrome.downloads.download({
            url: download.url || 'data:text/plain,', // Use original URL or empty data
            filename: file,
            conflictAction: 'uniquify', // Don't overwrite existing file
            saveAs: false
          }, (id) => {
            if (chrome.runtime.lastError) {
              reject(chrome.runtime.lastError);
            } else {
              resolve(id);
            }
          });
        });
        
        // Wait a moment for download to register
        await new Promise(resolve => setTimeout(resolve, 500));
        
        // Cancel the download (we don't want to re-download)
        await chrome.downloads.cancel(downloadId);
        
        // Now try to show it
        chrome.downloads.show(downloadId);
        
        // Save this ID
        download.chromeDownloadId = downloadId;
        await saveDownloads();
        
        return { success: true };
      } catch (e) {
        console.log('Failed to create fake download:', e);
      }
    }
    
    // Method 4: Open directory in browser (opens native file manager)
    if (filepath) {
      try {
        // Extract directory path
        const parts = filepath.split(/[/\\]/);
        parts.pop(); // Remove filename
        const directory = parts.join('/');
        
        // Open directory as file:// URL
        // This will open in the system's default file manager:
        // - macOS: Finder
        // - Windows: Explorer
        // - Linux: Nautilus, Dolphin, etc.
        const fileUrl = 'file://' + directory;
        
        await chrome.tabs.create({ url: fileUrl, active: false });
        
        // Close the tab after a moment (file manager will have opened)
        setTimeout(async () => {
          const tabs = await chrome.tabs.query({ url: fileUrl });
          tabs.forEach(tab => chrome.tabs.remove(tab.id));
        }, 1000);
        
        return { success: true };
      } catch (e) {
        console.log('Failed to open directory:', e);
      }
    }
    
    // Final fallback: Show notification with file path
    createNotification({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'File Location',
      message: `File saved at:\n${filepath}\n\nPlease open this location manually.`,
      isClickable: true
    });
    
    return { 
      success: false, 
      error: `File is located at: ${filepath}` 
    };
    
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Update URL for an existing download (useful when links expire)
async function updateDownloadUrl(gid, newUrl) {
  try {
    const download = downloads[gid];
    if (!download) {
      return { success: false, error: 'Download not found' };
    }
    
    console.log('[Aria2 Downloader] Updating URL for:', download.filename);
    console.log('[Aria2 Downloader] Old URL:', download.url);
    console.log('[Aria2 Downloader] New URL:', newUrl);
    
    // Update the URL
    download.url = newUrl;
    
    // Reset retry counter for fresh attempt
    download.retryCount = 0;
    download.lastRetryTime = 0;
    download.status = 'paused';
    
    await saveDownloads();
    
    createNotification({
      type: 'basic',
      iconUrl: 'icons/icon48.png',
      title: 'Download URL Updated',
      message: `URL updated for ${download.filename}. Click Resume to continue.`
    });
    
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

async function restartDownloadAfterRename(download) {
  const oldGid = download.gid;
  const preserved = { ...download };
  const metadata = {
    pageUrl: download.pageUrl || '',
    pageTitle: download.pageTitle || ''
  };
  
  // Remove from tracking so addDownload doesn't treat it as duplicate
  delete downloads[oldGid];
  await saveDownloads();
  
  try {
    try {
      await aria2RPC('aria2.forcePause', [oldGid]);
    } catch (e) {
      // Already paused or gone - safe to ignore
    }
    
    try {
      await aria2RPC('aria2.remove', [oldGid]);
    } catch (e) {
      try {
        await aria2RPC('aria2.removeDownloadResult', [oldGid]);
      } catch (e2) {
        // aria2 may have already dropped it
      }
    }
    
    const result = await startDownload(preserved.url, preserved.filename, metadata);
    if (!result.success) {
      downloads[oldGid] = preserved;
      downloads[oldGid].renameRequiresRestart = true;
      await saveDownloads();
      return { success: false, error: result.error || 'Failed to restart download with new filename' };
    }
    
    const newGid = result.gid;
    const newDownload = downloads[newGid];
    if (newDownload) {
      newDownload.renameRequiresRestart = false;
      newDownload.renameRequestedAt = preserved.renameRequestedAt;
      newDownload.pendingRenameFrom = undefined;
      newDownload.pageUrl = metadata.pageUrl;
      newDownload.pageTitle = metadata.pageTitle;
      newDownload.retryCount = preserved.retryCount || 0;
      newDownload.lastRetryTime = preserved.lastRetryTime || 0;
      if (preserved.previousFilenames) {
        newDownload.previousFilenames = preserved.previousFilenames;
      }
      if (preserved.renamedFrom) {
        newDownload.renamedFrom = preserved.renamedFrom;
      }
    }
    
    await saveDownloads();
    logInfo('Restarted download with new filename', {
      oldGid,
      newGid,
      filename: preserved.filename
    });
    
    return { success: true, message: 'Download restarted with new filename', restarted: true, gid: newGid };
  } catch (error) {
    downloads[oldGid] = preserved;
    downloads[oldGid].renameRequiresRestart = true;
    await saveDownloads();
    return { success: false, error: error.message };
  }
}

// Message handler
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  (async () => {
    switch (request.action) {
      case 'captureVideo':
        const skipConfirm = request.skipConfirmation === true;
        const result = await addDownload(request.url, request.filename, {
          pageUrl: request.pageUrl,
          pageTitle: request.pageTitle
        }, skipConfirm);
        sendResponse(result);
        break;
        
      case 'getDownloads':
        await updateDownloadsStatus();
        sendResponse({ downloads });
        break;
        
      case 'pauseDownload':
        const pauseResult = await pauseDownload(request.gid);
        sendResponse(pauseResult);
        break;
        
      case 'resumeDownload':
        const resumeResult = await resumeDownload(request.gid);
        sendResponse(resumeResult);
        break;
        
      case 'updateDownloadUrl':
        const updateResult = await updateDownloadUrl(request.gid, request.newUrl);
        sendResponse(updateResult);
        break;
        
      case 'confirmDownload':
        // Confirm filename and start download
        const confirmationDownload = downloads[request.confirmationId];
        if (!confirmationDownload || confirmationDownload.status !== 'awaiting_confirmation') {
          sendResponse({ success: false, error: 'Confirmation request not found or expired' });
          break;
        }
        
        const confirmedFilename = request.filename ? request.filename.trim() : confirmationDownload.filename;
        const url = confirmationDownload.url;
        const metadata = {
          pageUrl: confirmationDownload.pageUrl || '',
          pageTitle: confirmationDownload.pageTitle || ''
        };
        
        // Remove the confirmation entry
        delete downloads[request.confirmationId];
        await saveDownloads();
        
        // Start the actual download with skipConfirmation = true
        const confirmResult = await startDownload(url, confirmedFilename, metadata, true);
        sendResponse(confirmResult);
        break;
        
      case 'cancelConfirmation':
        // Cancel filename confirmation
        if (request.confirmationId && downloads[request.confirmationId]) {
          delete downloads[request.confirmationId];
          await saveDownloads();
          sendResponse({ success: true, cancelled: true });
        } else {
          sendResponse({ success: false, error: 'Confirmation request not found' });
        }
        break;
        
      case 'removeDownload':
        const removeResult = await removeDownload(request.gid);
        sendResponse(removeResult);
        break;
        
      case 'updateConfig':
        aria2Config = { ...aria2Config, ...request.config };
        await saveConfig();
        sendResponse({ success: true });
        break;
        
      case 'getConfig':
        sendResponse({ config: aria2Config });
        break;
        
      case 'showInFolder':
        const showResult = await showFileInFolder(request.filepath);
        sendResponse(showResult);
        break;
        
      case 'clearHistory':
        const clearedCount = await clearHistory();
        sendResponse({ success: true, cleared: clearedCount });
        break;
        
      case 'exportBackup':
        const exportResult = await exportBackup();
        sendResponse(exportResult);
        break;
        
      case 'importBackup':
        const importResult = await importBackup(request.backupData);
        sendResponse(importResult);
        break;
        
      case 'toggleInterception':
        interceptionEnabled = !interceptionEnabled;
        await chrome.storage.sync.set({ interceptionEnabled });
        updateBadgeColor();
        console.log('[Aria2 Downloader] Interception toggled:', interceptionEnabled);
        sendResponse({ success: true, enabled: interceptionEnabled });
        break;
        
      case 'getInterceptionState':
        sendResponse({ enabled: interceptionEnabled });
        break;
        
      case 'startQueuedDownload':
        const queuedResult = await startQueuedDownloadManually(request.queueId);
        sendResponse(queuedResult);
        break;
        
      case 'clearCompletedDownloads':
        let removed = 0;
        Object.keys(downloads).forEach(gid => {
          if (downloads[gid].status === 'complete') {
            delete downloads[gid];
            removed++;
          }
        });
        await saveDownloads();
        sendResponse({ success: true, removed });
        break;
        
      case 'manualAddDownload':
        if (!request.url) {
          sendResponse({ success: false, error: 'URL is required' });
          break;
        }
        try {
          const manualFilename = request.filename || getFilenameFromUrl(request.url);
          const skipConfirm = request.skipConfirmation === true;
          const manualResult = await addDownload(request.url, manualFilename, {
            pageUrl: '',
            pageTitle: 'Manual Add'
          }, skipConfirm);
          sendResponse(manualResult);
        } catch (error) {
          sendResponse({ success: false, error: error.message });
        }
        break;
        
      case 'manualAddDownloads': {
        let entries = [];
        if (Array.isArray(request.items)) {
          entries = request.items
            .filter(item => item && item.url)
            .map(item => ({
              url: item.url,
              filenameOverride: item.filename
            }));
        } else if (Array.isArray(request.urls)) {
          entries = request.urls
            .filter(url => !!url)
            .map(url => ({ url }));
        }
        
        if (entries.length === 0) {
          sendResponse({ success: false, error: 'No URLs provided' });
          break;
        }
        
        const manualBatchResults = [];
        let manualAdded = 0;
        let manualDupes = 0;
        let manualFailures = 0;
        
        for (const entry of entries) {
          const url = entry.url;
          const desiredName = entry.filenameOverride ? entry.filenameOverride.trim() : '';
          const filename = desiredName || getFilenameFromUrl(url);
          try {
            const result = await addDownload(url, filename, {
              pageUrl: '',
              pageTitle: 'Manual Add'
            });
            if (result.success) {
              manualAdded++;
            } else if (result.duplicate) {
              manualDupes++;
            } else {
              manualFailures++;
            }
            manualBatchResults.push({ url, filename, ...result });
          } catch (error) {
            manualFailures++;
            manualBatchResults.push({ url, filename, success: false, error: error.message });
          }
        }
        
        sendResponse({
          success: manualAdded > 0 || manualDupes > 0,
          total: entries.length,
          added: manualAdded,
          duplicates: manualDupes,
          failures: manualFailures,
          results: manualBatchResults
        });
        break;
      }
        
      case 'updatePreferences':
        if (request.preferences) {
          if (typeof request.preferences.showNotifications === 'boolean') {
            showNotifications = request.preferences.showNotifications;
            await chrome.storage.sync.set({ showNotifications });
          }
        }
        sendResponse({ success: true });
        break;
        
      case 'directoryListingStatus':
        if (sender.tab && sender.tab.id !== undefined) {
          recordDirectoryListingStatus(
            sender.tab.id,
            !!request.hasListing,
            request.fileCount || 0
          );
        }
        logInfo('Directory listing status updated', {
          tabId: sender.tab?.id,
          hasListing: !!request.hasListing,
          fileCount: request.fileCount || 0
        });
        sendResponse({ success: true });
        break;
        
      case 'downloadMultiple':
        const downloadsRequest = Array.isArray(request.downloads) ? request.downloads : [];
        if (downloadsRequest.length === 0) {
          sendResponse({ success: false, error: 'No downloads specified' });
          break;
        }
        
        logInfo('Processing batch download request', { count: downloadsRequest.length });
        const batchResults = [];
        let addedCount = 0;
        let duplicateCount = 0;
        let failureCount = 0;
        
        for (const item of downloadsRequest) {
          if (!item || !item.url || !item.filename) {
            batchResults.push({
              url: item?.url || null,
              filename: item?.filename || null,
              success: false,
              error: 'Invalid download request'
            });
            failureCount += 1;
            continue;
          }
          
          const metadata = {
            pageUrl: item.pageUrl || sender?.tab?.url || '',
            pageTitle: item.pageTitle || sender?.tab?.title || ''
          };
          
          const result = await addDownload(item.url, item.filename, metadata);
          
          if (result.success) {
            addedCount += 1;
          } else if (result.duplicate) {
            duplicateCount += 1;
          } else {
            failureCount += 1;
          }
          
          batchResults.push({
            url: item.url,
            filename: item.filename,
            success: !!result.success,
            duplicate: !!result.duplicate,
            error: result.error || null
          });
        }
        
        sendResponse({
          success: addedCount > 0 || duplicateCount > 0,
          total: downloadsRequest.length,
          added: addedCount,
          duplicates: duplicateCount,
          failures: failureCount,
          results: batchResults
        });
        logInfo('Batch download summary', {
          total: downloadsRequest.length,
          added: addedCount,
          duplicates: duplicateCount,
          failures: failureCount
        });
        break;
        
      case 'getLogs':
        const logs = await loadLogBuffer();
        sendResponse({ success: true, logs });
        break;
        
      case 'clearLogs':
        await clearLogs();
        logInfo('Logs cleared manually via message');
        sendResponse({ success: true });
        break;
        
      default:
        sendResponse({ error: 'Unknown action' });
    }
  })();
  
  return true; // Keep channel open for async response
});

// Backup and Restore Functions

// Create backup data
async function createBackup() {
  // Get all settings from storage
  const syncData = await chrome.storage.sync.get(['fileExtensions', 'customFileExtensions', 'autoResume', 'showNotifications', 'interceptionEnabled']);
  
  const backupData = {
    version: '1.0',
    timestamp: Date.now(),
    config: aria2Config,
    downloads: downloads,
    fileExtensions: syncData.fileExtensions || null,
    customFileExtensions: syncData.customFileExtensions || null,
    autoResume: syncData.autoResume !== undefined ? syncData.autoResume : true,
    showNotifications: syncData.showNotifications !== undefined ? syncData.showNotifications : true,
    interceptionEnabled: syncData.interceptionEnabled !== undefined ? syncData.interceptionEnabled : true
  };
  return backupData;
}

// Note: File backups removed - service workers don't support URL.createObjectURL
// Automatic backups now use chrome.storage.local only (more reliable anyway)

// Restore from backup file
async function restoreFromBackup() {
  try {
    // Try to read from local storage first (most reliable backup)
    const result = await chrome.storage.local.get(['lastBackup']);
    if (result.lastBackup) {
      const backupData = result.lastBackup;
      
      // Check if backup is recent (not too old)
      const backupAge = Date.now() - backupData.timestamp;
      const maxAge = 30 * 24 * 60 * 60 * 1000; // 30 days
      
      if (backupAge < maxAge) {
        // Restore config if valid
        if (backupData.config) {
          aria2Config = { ...aria2Config, ...backupData.config };
          await chrome.storage.sync.set({ aria2Config: backupData.config });
        }
        
        // Restore downloads if valid
        if (backupData.downloads) {
          downloads = backupData.downloads;
          await chrome.storage.local.set({ downloads: backupData.downloads });
        }
        
        // Restore file extensions if valid
        if (backupData.fileExtensions) {
          await chrome.storage.sync.set({ fileExtensions: backupData.fileExtensions });
        }
        
        // Restore custom file extensions if valid
        if (backupData.customFileExtensions) {
          await chrome.storage.sync.set({ customFileExtensions: backupData.customFileExtensions });
        }
        
        // Restore behavior settings
        if (backupData.autoResume !== undefined) {
          await chrome.storage.sync.set({ autoResume: backupData.autoResume });
        }
        
        if (backupData.showNotifications !== undefined) {
          await chrome.storage.sync.set({ showNotifications: backupData.showNotifications });
        }
        
        if (backupData.interceptionEnabled !== undefined) {
          interceptionEnabled = backupData.interceptionEnabled;
          await chrome.storage.sync.set({ interceptionEnabled: backupData.interceptionEnabled });
        }
        
        const backupDate = new Date(backupData.timestamp).toLocaleString();
        console.log('[Aria2 Downloader] ✅ Restored from backup:', backupDate);
        console.log('[Aria2 Downloader] Restored:', {
          config: !!backupData.config,
          downloads: !!backupData.downloads,
          fileExtensions: !!backupData.fileExtensions,
          customFileExtensions: !!backupData.customFileExtensions,
          interceptionEnabled: backupData.interceptionEnabled
        });
        
        // Show notification
        createNotification({
          type: 'basic',
          iconUrl: 'icons/icon48.png',
          title: 'Settings Restored',
          message: `Your settings and downloads have been restored from ${backupDate}`
        });
        
        return { success: true, restored: true, timestamp: backupData.timestamp };
      } else {
        console.log('[Aria2 Downloader] Backup too old, not restoring');
      }
    } else {
      console.log('[Aria2 Downloader] No backup found');
    }
    
    return { success: true, restored: false };
  } catch (error) {
    console.error('[Aria2 Downloader] Restore failed:', error);
    return { success: false, error: error.message };
  }
}

// Save backup to local storage (always works, survives reinstall if user data kept)
async function saveBackupToStorage() {
  try {
    const backupData = await createBackup();
    await chrome.storage.local.set({ lastBackup: backupData });
    console.log('[Aria2 Downloader] Backup saved to storage');
    return { success: true };
  } catch (error) {
    console.error('[Aria2 Downloader] Storage backup failed:', error);
    return { success: false, error: error.message };
  }
}

// Perform backup to storage (automatic backups)
async function performBackup() {
  await saveBackupToStorage();
}

// Start automatic backup schedule
function startBackupSchedule() {
  if (backupInterval) {
    clearInterval(backupInterval);
  }
  
  // Backup every 5 minutes (more frequent to catch uninstalls)
  backupInterval = setInterval(async () => {
    await performBackup();
  }, 300000); // 5 minutes
  
  // Perform initial backup on startup
  performBackup();
  
  console.log('[Aria2 Downloader] Backup schedule started (every 5 minutes)');
}

// Manual export for user (using data URL instead of blob)
async function exportBackup() {
  try {
    const backupData = await createBackup();
    const jsonString = JSON.stringify(backupData, null, 2);
    
    // Use data URL instead of blob URL (works in service workers)
    const dataUrl = 'data:application/json;charset=utf-8,' + encodeURIComponent(jsonString);
    
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, -5);
    const filename = `aria2-downloader-backup-${timestamp}.json`;
    
    await chrome.downloads.download({
      url: dataUrl,
      filename: filename,
      saveAs: true
    });
    
    return { success: true, filename };
  } catch (error) {
    return { success: false, error: error.message };
  }
}

// Manual import for user
async function importBackup(backupData) {
  try {
    // Validate backup data
    if (!backupData || !backupData.version) {
      throw new Error('Invalid backup file format');
    }
    
    // Restore config
    if (backupData.config) {
      aria2Config = { ...aria2Config, ...backupData.config };
      await chrome.storage.sync.set({ aria2Config: backupData.config });
    }
    
    // Restore downloads
    if (backupData.downloads) {
      downloads = backupData.downloads;
      await chrome.storage.local.set({ downloads: backupData.downloads });
    }
    
    // Restore file extensions
    if (backupData.fileExtensions) {
      await chrome.storage.sync.set({ fileExtensions: backupData.fileExtensions });
    }
    
    // Restore custom file extensions
    if (backupData.customFileExtensions) {
      await chrome.storage.sync.set({ customFileExtensions: backupData.customFileExtensions });
    }
    
    // Restore behavior settings
    if (backupData.autoResume !== undefined) {
      await chrome.storage.sync.set({ autoResume: backupData.autoResume });
    }
    
    if (backupData.showNotifications !== undefined) {
      await chrome.storage.sync.set({ showNotifications: backupData.showNotifications });
    }
    
    if (backupData.interceptionEnabled !== undefined) {
      interceptionEnabled = backupData.interceptionEnabled;
      await chrome.storage.sync.set({ interceptionEnabled: backupData.interceptionEnabled });
    }
    
    // Save to storage for future restores
    await saveBackupToStorage();
    
    console.log('[Aria2 Downloader] Imported backup from:', new Date(backupData.timestamp));
    console.log('[Aria2 Downloader] Imported:', {
      config: !!backupData.config,
      downloads: !!backupData.downloads,
      fileExtensions: !!backupData.fileExtensions,
      customFileExtensions: !!backupData.customFileExtensions,
      interceptionEnabled: backupData.interceptionEnabled
    });
    
    return { success: true, timestamp: backupData.timestamp };
  } catch (error) {
    console.error('[Aria2 Downloader] Import failed:', error);
    return { success: false, error: error.message };
  }
}

// Store downloads we want to intercept (keyed by download ID)
const downloadsToIntercept = new Map();

// Intercept browser downloads EARLY using onDeterminingFilename
chrome.downloads.onDeterminingFilename.addListener((downloadItem, suggest) => {
  console.log('[Aria2 Downloader] onDeterminingFilename triggered:', {
    url: downloadItem.url,
    filename: downloadItem.filename,
    interceptionEnabled: interceptionEnabled
  });
  
  // Don't intercept if disabled
  if (!interceptionEnabled) {
    console.log('[Aria2 Downloader] Interception disabled, allowing browser download');
    suggest();
    return;
  }
  
  try {
    const url = downloadItem.url;
    const filename = downloadItem.filename || '';
    
    // Check forced ignore list first
    if (shouldIgnoreDownload(url, filename)) {
      suggest();
      return;
    }
    
    // Parse URL
    const urlObj = new URL(url);
    const hostname = urlObj.hostname.toLowerCase();
    
    // Check if this is a download we should ignore (prevents loops)
    const downloadKey = `${url}|${filename}`;
    if (ignoreNextDownloads.has(downloadKey)) {
      console.log('[Aria2 Downloader] Ignoring download (in ignore list - prevents loop)');
      ignoreNextDownloads.delete(downloadKey);
      suggest();
      return;
    }
    
    // Check file extension
    const urlLower = url.toLowerCase();
    const filenameLower = filename.toLowerCase();
    
    let urlPath = urlLower;
    try {
      const urlObj = new URL(url);
      urlPath = urlObj.pathname;
    } catch (e) {
      // If URL parsing fails, use the full URL
    }
    
    const extensions = cachedInterceptExtensions;
    
    const matchesExtension = extensions.some(ext => {
      const extLower = ext.toLowerCase();
      return urlPath.endsWith(extLower) || filenameLower.endsWith(extLower);
    });
    
    if (matchesExtension) {
      console.log('[Aria2 Downloader] ✓ Intercepting download, will cancel and add to aria2');
      
      // Extract final filename
      let finalFilename = filename;
      if (!finalFilename) {
        try {
          const urlObj = new URL(url);
          finalFilename = urlObj.pathname.split('/').pop() || 'download';
        } catch (e) {
          finalFilename = 'download_' + Date.now();
        }
      }
      
      // Remove any path from filename
      finalFilename = finalFilename.split(/[/\\]/).pop();
      
      // Store download info to intercept after Chrome resolves the URL
      downloadsToIntercept.set(downloadItem.id, {
        url: url,
        filename: finalFilename,
        referrer: downloadItem.referrer
      });
      
      // Acknowledge with the filename, then cancel
      suggest({ filename: finalFilename, conflict_action: 'uniquify' });
      
      // Then cancel the download asynchronously - we'll add it to aria2 in onChanged
      setTimeout(() => {
        chrome.downloads.cancel(downloadItem.id, () => {
          if (chrome.runtime.lastError) {
            console.log('[Aria2 Downloader] Could not cancel download:', chrome.runtime.lastError.message);
          } else {
            console.log('[Aria2 Downloader] Download cancelled, will be added to aria2');
          }
        });
      }, 100); // Small delay to ensure Chrome has created the download
      return;
    } else {
      console.log('[Aria2 Downloader] Not intercepting, allowing Chrome download');
      suggest();
    }
  } catch (error) {
    console.error('[Aria2 Downloader] Error in onDeterminingFilename:', error);
    suggest();
  }
});

// Handle cancelled downloads - add them to aria2
chrome.downloads.onChanged.addListener(async (delta) => {
  // Check if this download was cancelled and is one we want to intercept
  if (delta.state && delta.state.current === 'interrupted' && downloadsToIntercept.has(delta.id)) {
    const downloadInfo = downloadsToIntercept.get(delta.id);
    downloadsToIntercept.delete(delta.id);
    
    console.log('[Aria2 Downloader] Download interrupted (as expected), adding to aria2:', downloadInfo);
    
    // Extract filename
    let finalFilename = downloadInfo.filename;
    if (!finalFilename) {
      try {
        const urlObj = new URL(downloadInfo.url);
        finalFilename = urlObj.pathname.split('/').pop() || 'download';
      } catch (e) {
        finalFilename = 'download_' + Date.now();
      }
    }
    
    // Remove any path from filename
    finalFilename = finalFilename.split(/[/\\]/).pop();
    
    // Add to aria2
    const result = await addDownload(
      downloadInfo.url,
      finalFilename,
      {
        pageUrl: downloadInfo.referrer || downloadInfo.url,
        pageTitle: 'Browser Download'
      },
      true // User already confirmed name in the browser Save dialog
    );
    
    if (result.success) {
      console.log('[Aria2 Downloader] ✓ Download added to aria2 successfully');
    } else {
      console.error('[Aria2 Downloader] ✗ Failed to add to aria2:', result.error);
    }
    
    // Erase from Chrome download history
    chrome.downloads.erase({ id: delta.id }, () => {
      if (chrome.runtime.lastError) {
        console.log('[Aria2 Downloader] Could not erase download:', chrome.runtime.lastError.message);
      }
    });
  }
});

// NOTE: We use onDeterminingFilename to intercept downloads early, before Chrome commits.
// By not calling suggest(), we prevent Chrome from downloading while still capturing the URL.
// The download is added to aria2 immediately to prevent expiring links (common with file hosts).

// Load downloads on startup
loadDownloads();
