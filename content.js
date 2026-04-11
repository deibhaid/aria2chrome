// Content script to intercept file downloads

let interceptionEnabled = true; // Track if interception is enabled

// Default extensions (video files + archives)
let FILE_EXTENSIONS = [
  // Video files
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg',
  '.3gp', '.ogv', '.ts', '.m3u8', '.f4v', '.vob', '.rm', '.rmvb',
  // Archive files
  '.rar', '.zip', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tar.gz', '.tar.bz2', '.tar.xz',
  '.tgz', '.tbz2', '.txz', '.z', '.lz', '.lzma', '.cab', '.iso', '.dmg'
];

function mergeCustomExtensions(base, custom) {
  const set = new Set(base.map((e) => e.toLowerCase()));
  const out = base.slice();
  (custom || []).forEach((e) => {
    const ext = (e || '').trim();
    if (!ext) return;
    const low = ext.toLowerCase();
    if (!set.has(low)) {
      set.add(low);
      out.push(ext.startsWith('.') ? ext : `.${ext}`);
    }
  });
  return out;
}

function isExtensionRuntimeValid() {
  try {
    return !!(typeof chrome !== 'undefined' && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

/** Send message to background; handles lastError / invalidated extension context (e.g. after reload). */
function sendToBackground(message, callback) {
  if (!isExtensionRuntimeValid()) {
    if (callback) callback(null);
    return;
  }
  try {
    chrome.runtime.sendMessage(message, (response) => {
      const err = chrome.runtime.lastError;
      if (err) {
        console.warn('[Aria2 Downloader] sendMessage:', err.message);
        if (callback) callback(null);
        return;
      }
      if (callback) callback(response);
    });
  } catch (e) {
    console.warn('[Aria2 Downloader] sendMessage threw:', e);
    if (callback) callback(null);
  }
}

// Load custom extensions and interception state from storage
chrome.storage.sync.get(['fileExtensions', 'customFileExtensions', 'interceptionEnabled'], function(result) {
  if (result.fileExtensions && result.fileExtensions.length > 0) {
    FILE_EXTENSIONS = result.fileExtensions;
    console.log('[Aria2 Downloader] Loaded file extensions:', FILE_EXTENSIONS);
  }
  if (result.customFileExtensions && result.customFileExtensions.length > 0) {
    FILE_EXTENSIONS = mergeCustomExtensions(FILE_EXTENSIONS, result.customFileExtensions);
    console.log('[Aria2 Downloader] Merged custom file extensions');
  }
  if (result.interceptionEnabled !== undefined) {
    interceptionEnabled = result.interceptionEnabled;
    console.log('[Aria2 Downloader] Interception enabled:', interceptionEnabled);
  }
});

// Listen for extension updates
chrome.storage.onChanged.addListener(function(changes, namespace) {
  if (namespace === 'sync' && changes.fileExtensions) {
    FILE_EXTENSIONS = changes.fileExtensions.newValue;
    console.log('[Aria2 Downloader] Updated file extensions:', FILE_EXTENSIONS);
  }
  if (namespace === 'sync' && changes.customFileExtensions) {
    chrome.storage.sync.get(['fileExtensions', 'customFileExtensions'], function(r) {
      const base = r.fileExtensions && r.fileExtensions.length > 0 ? r.fileExtensions : FILE_EXTENSIONS;
      FILE_EXTENSIONS = mergeCustomExtensions(base, r.customFileExtensions || []);
      console.log('[Aria2 Downloader] Updated after custom extensions change:', FILE_EXTENSIONS);
    });
  }
  if (namespace === 'sync' && changes.interceptionEnabled) {
    interceptionEnabled = changes.interceptionEnabled.newValue;
    console.log('[Aria2 Downloader] Interception toggled:', interceptionEnabled);
  }
});

// Apache/nginx autoindex and similar: file links live under long paths like /music/Catalog/a.mp3
// — not covered by "short path" heuristics; link text may be truncated (no ".mp3" in the label).
function isHttpDirectoryIndexPage() {
  const title = (document.title || '').trim().toLowerCase();
  if (!title.startsWith('index of') || !document.body) {
    return false;
  }
  return !!document.querySelector('a[href="../"], a[href$="../"], a[href="/"], a[href^="../"]');
}

// Function to check if URL or text is a downloadable file
function isVideoUrl(url, downloadAttr = '', linkText = '', target = null) {
  if (!url) return false;
  
  try {
    const urlObj = new URL(url, window.location.href);
    const pathname = urlObj.pathname.toLowerCase();
    const hostname = urlObj.hostname.toLowerCase();
    
    // Don't intercept navigation links on known intermediary sites
    const intermediarySites = [
      'multiup.io',
      'uptobox.com', 
      'uploaded.net',
      'rapidgator.net',
      '1fichier.com'
    ];
    
    // If it's an intermediary site and URL just has filename in path (not actual download)
    if (intermediarySites.some(site => hostname.includes(site))) {
      // Only intercept if it has a download attribute or if target has download attribute
      if (!downloadAttr && target && !target.hasAttribute('download')) {
        console.log('[Aria2 Downloader] Skipping intermediary page:', url);
        return false;
      }
    }
    
    // Check if URL ends with any tracked extension
    if (FILE_EXTENSIONS.some(ext => pathname.endsWith(ext.toLowerCase()))) {
      // For IP addresses or local servers, always intercept file extensions
      const isIPAddress = /^(\d{1,3}\.){3}\d{1,3}$/.test(hostname);
      const isLocalhost = hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('192.168.') || hostname.startsWith('10.');
      
      console.log('[Aria2 Downloader] File extension match:', {
        hostname: hostname,
        pathname: pathname,
        isIPAddress: isIPAddress,
        isLocalhost: isLocalhost
      });
      
      if (isIPAddress || isLocalhost) {
        console.log('[Aria2 Downloader] ✓ IP/Local address detected - will intercept');
        return true; // Always intercept files from IP/local addresses
      }

      // Open HTTP indexes (e.g. "Index of /music/Catalog/") — long paths like
      // /music/Catalog/All%20About%20That%20Bass%20-%20Meghan%20Trainor.mp3 are
      // not "short path" downloads; link labels may be truncated (no ".mp3" in text).
      if (isHttpDirectoryIndexPage()) {
        console.log('[Aria2 Downloader] ✓ HTTP directory index — will intercept');
        return true;
      }
      
      // For domain names, check if it's a direct download link
      const isDirectDownload = 
        downloadAttr || // Has download attribute = definite download
        pathname.includes('/files/') ||
        pathname.includes('/get/') ||
        pathname.includes('/dl/') ||
        pathname.includes('/download/') ||
        pathname.includes('/media/') ||
        pathname.includes('/music/') ||
        pathname.includes('/video/') ||
        pathname.includes('/movie/') ||
        hostname.includes('file-') || // file-server.gofile.io
        hostname.includes('cdn') || // CDN links
        hostname.includes('storage') || // storage servers
        pathname.split('/').length <= 3; // Short paths like /file.mp4
      
      if (isDirectDownload) {
        return true;
      }
    }
    
    // Check download attribute (for download links with filename)
    if (downloadAttr) {
      const downloadLower = downloadAttr.toLowerCase();
      if (FILE_EXTENSIONS.some(ext => downloadLower.endsWith(ext.toLowerCase()))) {
        return true;
      }
    }
    
    // Check link text content (fallback for some websites)
    if (linkText) {
      const textLower = linkText.toLowerCase();
      if (FILE_EXTENSIONS.some(ext => textLower.includes(ext.toLowerCase()))) {
        return true;
      }
    }
    
    return false;
  } catch (e) {
    return false;
  }
}

// Function to extract filename from URL or download attribute
function getFilenameFromUrl(url, downloadAttr = '', linkText = '') {
  // First, try the download attribute (most reliable for download links)
  if (downloadAttr && downloadAttr.trim()) {
    return decodeURIComponent(downloadAttr.trim());
  }
  
  // Try to extract from URL path FIRST (most accurate for direct file links)
  try {
    const urlObj = new URL(url, window.location.href);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();
    
    console.log('[Aria2 Downloader] getFilenameFromUrl: extracted from URL:', filename);
    
    // If we got a meaningful filename from URL, decode and use it
    if (filename && FILE_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext.toLowerCase()))) {
      // Decode URL encoding
      try {
        const decoded = decodeURIComponent(filename);
        console.log('[Aria2 Downloader] getFilenameFromUrl: decoded', filename, '->', decoded);
        return decoded;
      } catch (e) {
        // If decode fails, return as-is
        console.warn('[Aria2 Downloader] getFilenameFromUrl: decode failed:', e);
        return filename;
      }
    }
  } catch (e) {
    // Continue to fallback
    console.warn('[Aria2 Downloader] getFilenameFromUrl: URL parse failed:', e);
  }
  
  // Try to extract filename from link text if it contains extension
  if (linkText) {
    const extensionPattern = FILE_EXTENSIONS.map(ext => ext.replace('.', '\\.')).join('|');
    const regex = new RegExp(`([^\\\\/]+\\.(${extensionPattern.replace(/\\\./g, '')}))`, 'i');
    const match = linkText.match(regex);
    if (match) {
      // Link text is already decoded by the browser, no need to decode again
      return match[1].trim();
    }
  }
  
  // Fallback: Try to find filename in nearby DOM elements (for sites like vadapav.mov)
  // Look for the filename in page title or nearby text
  try {
    const pageTitle = document.title;
    const extensionPattern = FILE_EXTENSIONS.map(ext => ext.replace('.', '\\.')).join('|');
    const regex = new RegExp(`([^\\\\/]+\\.(${extensionPattern.replace(/\\\./g, '')}))`, 'i');
    const match = pageTitle.match(regex);
    if (match) {
      return match[1].trim();
    }
  } catch (e) {
    // Continue to fallback
  }
  
  // Final fallback: generate a filename with timestamp
  return 'download_' + Date.now();
}

// Intercept clicks on links
document.addEventListener('click', function(event) {
  console.log('[Aria2 Downloader] Click detected on page:', {
    target: event.target,
    tagName: event.target.tagName
  });
  
  let target = event.target;
  
  // Traverse up to find anchor tag or button (go up more levels to handle nested elements)
  let depth = 0;
  while (target && target.tagName !== 'A' && target.tagName !== 'BUTTON' && depth < 10) {
    target = target.parentElement;
    depth++;
  }
  
  console.log('[Aria2 Downloader] After traversal, target:', target ? target.tagName : 'null', 'depth:', depth);
  
  // Handle link clicks
  if (target && target.tagName === 'A') {
    const href = target.href;
    const downloadAttr = target.getAttribute('download') || '';
    const linkText = target.textContent || target.innerText || '';
    
    // Debug logging
    console.log('[Aria2 Downloader] Link clicked:', {
      href: href,
      downloadAttr: downloadAttr,
      linkText: linkText.substring(0, 50), // Truncate for readability
      isVideo: isVideoUrl(href, downloadAttr, linkText, target)
    });
    
    if (isVideoUrl(href, downloadAttr, linkText, target)) {
      // Don't intercept if disabled
      if (!interceptionEnabled) {
        console.log('[Aria2 Downloader] Interception disabled, allowing browser download');
        return;
      }
      
      console.log('[Aria2 Downloader] ✓ Intercepting download for:', href);
      
      // Prevent default download
      event.preventDefault();
      event.stopPropagation();
      
      const filename = getFilenameFromUrl(href, downloadAttr, linkText);
      
      // Ensure filename is decoded (double-decode protection)
      let decodedFilename = filename;
      try {
        // Check if filename contains URL encoding
        if (filename.includes('%')) {
          decodedFilename = decodeURIComponent(filename);
          console.log('[Aria2 Downloader] Decoded filename from', filename, 'to', decodedFilename);
        }
      } catch (e) {
        console.warn('[Aria2 Downloader] Failed to decode filename:', e);
        decodedFilename = filename;
      }
      
      console.log('[Aria2 Downloader] Final filename to use:', decodedFilename);
      
      console.log('[Aria2 Downloader] Intercepted video download:', {
        url: href,
        filename: decodedFilename,
        originalFilename: filename,
        downloadAttr: downloadAttr
      });
      
      // Try to open file picker directly (we have user gesture from the click)
      if (window.showSaveFilePicker) {
        (async () => {
          try {
            const fileHandle = await window.showSaveFilePicker({
              suggestedName: decodedFilename,
              types: [{
                description: 'All Files',
                accept: {'*/*': []}
              }],
              excludeAcceptAllOption: false
            });
            
            const file = await fileHandle.getFile();
            const selectedFilename = file.name;
            
            // Send to background with skipConfirmation = true
            sendToBackground({
              action: 'captureVideo',
              url: href,
              filename: selectedFilename,
              pageUrl: window.location.href,
              pageTitle: document.title,
              skipConfirmation: true
            }, function(response) {
              if (response == null) {
                showNotification('Aria2Chrome', 'Extension was updated — refresh this page to continue.');
                return;
              }
              if (response && response.success) {
                if (!response.duplicate && !response.awaiting_confirmation) {
                  showNotification('Download started', `${selectedFilename} added to aria2`);
                }
              } else if (response && response.duplicate) {
                console.log('[Aria2 Downloader] Duplicate download skipped');
              } else {
                showNotification('Error', response?.error || 'Failed to add to aria2 queue');
              }
            });
            
          } catch (error) {
            if (error.name === 'AbortError') {
              // User cancelled file picker
              console.log('[Aria2 Downloader] File picker cancelled by user');
              showNotification('Cancelled', 'Download cancelled');
              return;
            }
            const msg = String(error && error.message ? error.message : error);
            if (msg.includes('Extension context invalidated')) {
              showNotification('Aria2Chrome', 'Extension was updated — refresh this page to continue.');
              return;
            }
            console.error('[Aria2 Downloader] File picker error:', error);
            showNotification('Error', 'Failed to open file picker: ' + msg);
          }
        })();
      } else {
        // Fallback: no file picker available, use prompt
        const confirmedName = prompt('Enter filename:', decodedFilename);
        if (!confirmedName || !confirmedName.trim()) {
          showNotification('Cancelled', 'Download cancelled');
          return;
        }
        
        sendToBackground({
          action: 'captureVideo',
          url: href,
          filename: confirmedName.trim(),
          pageUrl: window.location.href,
          pageTitle: document.title,
          skipConfirmation: true
        }, function(response) {
          if (response == null) {
            showNotification('Aria2Chrome', 'Extension was updated — refresh this page to continue.');
            return;
          }
          if (response && response.success) {
            if (!response.duplicate && !response.awaiting_confirmation) {
              showNotification('Download added', `${confirmedName.trim()} added to aria2 queue`);
            }
          } else if (response && response.duplicate) {
            console.log('[Aria2 Downloader] Duplicate download skipped');
          } else {
            showNotification('Error', response?.error || 'Failed to add to aria2 queue');
          }
        });
      }
    }
  }
  
  // Handle button clicks on file hosting sites (special case)
  if (target && target.tagName === 'BUTTON') {
    const buttonText = (target.textContent || target.innerText || '').toLowerCase().trim();
    const hostname = window.location.hostname.toLowerCase();
    
    // Check if this is a download button on a known file hosting site
    const isFileHostingSite = hostname.includes('gofile.io') || 
                               hostname.includes('multiup.io') ||
                               hostname.includes('multiup.org');
    
    const isDownloadButton = buttonText.includes('download') || 
                             buttonText.includes('télécharger') ||
                             target.classList.contains('download') ||
                             target.id.includes('download');
    
    if (isFileHostingSite && isDownloadButton) {
      console.log('[Aria2 Downloader] Download button detected on file hosting site');
      
      // Don't prevent default yet - we need to let the site process first
      // Instead, we'll monitor for the download event that follows
      
      // Mark that we're expecting a download
      window.__aria2_expecting_download = true;
      window.__aria2_download_timestamp = Date.now();
      
      console.log('[Aria2 Downloader] Marked as expecting download from button click');
    }
  }
}, true);

// Also intercept video elements with src attributes
document.addEventListener('click', function(event) {
  const target = event.target;
  
  if (target.tagName === 'VIDEO' || target.tagName === 'SOURCE') {
    const videoUrl = target.src || target.currentSrc;
    
    if (videoUrl && isVideoUrl(videoUrl, '', '')) {
      event.preventDefault();
      event.stopPropagation();
      
      const filename = getFilenameFromUrl(videoUrl, '', '');
      
      sendToBackground({
        action: 'captureVideo',
        url: videoUrl,
        filename: filename,
        pageUrl: window.location.href,
        pageTitle: document.title
      });
    }
  }
}, true);

// Show in-page notification
function showNotification(title, message) {
  const notification = document.createElement('div');
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    background: #333;
    color: white;
    padding: 15px 20px;
    border-radius: 5px;
    z-index: 999999;
    font-family: Arial, sans-serif;
    box-shadow: 0 4px 6px rgba(0,0,0,0.3);
    max-width: 300px;
  `;
  notification.innerHTML = `<strong>${title}</strong><br>${message}`;
  document.body.appendChild(notification);
  
  setTimeout(() => {
    notification.style.transition = 'opacity 0.5s';
    notification.style.opacity = '0';
    setTimeout(() => notification.remove(), 500);
  }, 3000);
}

// Listen for context menu events (right-click)
document.addEventListener('contextmenu', function(event) {
  let target = event.target;
  
  // Check if clicked on a link or video element
  if (target.tagName === 'A' || target.tagName === 'VIDEO' || target.tagName === 'SOURCE') {
    const url = target.href || target.src || target.currentSrc;
    const downloadAttr = target.getAttribute('download') || '';
    const linkText = target.textContent || target.innerText || '';
    
    if (url && isVideoUrl(url, downloadAttr, linkText)) {
      // Store the URL for context menu action
      sendToBackground({
        action: 'storeContextUrl',
        url: url,
        filename: getFilenameFromUrl(url, downloadAttr, linkText)
      });
    }
  }
});

// ----- HTTP Directory Index Support -----

function hasDirectoryListingHeuristics() {
  if (!document.body) {
    return false;
  }
  
  const title = (document.title || '').trim().toLowerCase();
  const bodySample = document.body.innerText ? document.body.innerText.slice(0, 400).toLowerCase() : '';
  const hasIndexText = title.startsWith('index of') || bodySample.includes('index of');
  const hasParentLink = !!document.querySelector('a[href="../"], a[href="/"], a[href^="../"], a[href$="../"]');
  const hasListingContainer = !!document.querySelector('pre a[href], table a[href], tbody a[href]');
  
  return (hasIndexText || hasParentLink) && hasListingContainer;
}

function getDirectoryLinkCandidates() {
  const selectors = [
    'pre a[href]',
    'table a[href]',
    'tbody a[href]',
    'ul a[href]',
    '.directory a[href]',
    '.listing a[href]'
  ];
  
  const links = new Set();
  selectors.forEach(selector => {
    document.querySelectorAll(selector).forEach(link => links.add(link));
  });
  
  return Array.from(links);
}

function collectDirectoryFilesFromIndex() {
  const currentUrl = new URL(window.location.href);
  const currentDirPath = currentUrl.pathname.endsWith('/') ? currentUrl.pathname :
    currentUrl.pathname.substring(0, currentUrl.pathname.lastIndexOf('/') + 1 || currentUrl.pathname.length);
  const normalizedDirPath = currentDirPath || '/';
  const files = new Map();
  
  getDirectoryLinkCandidates().forEach(link => {
    const rawHref = link.getAttribute('href');
    if (!rawHref) return;
    if (rawHref.startsWith('mailto:') || rawHref.startsWith('javascript:')) return;
    if (rawHref === '/' || rawHref === './' || rawHref === '../') return;
    
    const linkText = (link.textContent || '').trim().toLowerCase();
    if (!rawHref.replace(/[\s\r\n]+/g, '')) return;
    if (linkText === 'parent directory' || linkText === 'name') return;
    
    let fileUrl;
    try {
      fileUrl = new URL(rawHref, currentUrl.href);
    } catch (e) {
      return;
    }
    
    if (!['http:', 'https:'].includes(fileUrl.protocol)) return;
    if (fileUrl.origin !== currentUrl.origin) return;
    if (fileUrl.pathname.endsWith('/')) return; // Directory entry
    
    const fileDirPath = fileUrl.pathname.substring(0, fileUrl.pathname.lastIndexOf('/') + 1) || '/';
    if (fileDirPath !== normalizedDirPath) return; // Only current directory
    
    const filenameSegment = fileUrl.pathname.split('/').filter(Boolean).pop();
    let filename;
    try {
      filename = decodeURIComponent(filenameSegment || link.textContent || `file-${files.size + 1}`);
    } catch (e) {
      console.warn('[Aria2 Downloader] Directory index decode failed:', e);
      filename = (filenameSegment || link.textContent || `file-${files.size + 1}`);
    }
    filename = (filename || '').trim();
    
    if (!filename) return;
    if (!files.has(fileUrl.href)) {
      files.set(fileUrl.href, {
        url: fileUrl.href,
        filename: filename
      });
    }
  });
  
  return Array.from(files.values());
}

function notifyDirectoryListingStatus(hasListing, fileCount = 0) {
  sendToBackground({
    action: 'directoryListingStatus',
    hasListing,
    fileCount
  });
}

function processDirectoryDownloadAllRequest(triggerSource = 'context-menu', callback) {
  const files = collectDirectoryFilesFromIndex();
  
  if (!files.length) {
    showNotification('Aria2Chrome', 'No downloadable files detected in this directory.');
    callback?.({ success: false, reason: 'no_files' });
    return;
  }
  
  showNotification('Aria2Chrome', `Sending ${files.length} file(s) to aria2...`);
  
  sendToBackground({
    action: 'downloadMultiple',
    downloads: files.map(file => ({
      url: file.url,
      filename: file.filename,
      pageUrl: window.location.href,
      pageTitle: document.title,
      source: triggerSource
    }))
  }, response => {
    if (response == null) {
      showNotification('Aria2Chrome', 'Extension was updated — refresh this page to continue.');
      callback?.({ success: false, error: 'Extension context invalidated' });
      return;
    }
    if (!response || response.error) {
      const errorMsg = response?.error || 'Unknown error';
      showNotification('Aria2Chrome', `Download-all failed: ${errorMsg}`);
      callback?.({ success: false, error: errorMsg });
      return;
    }
    
    const added = response.added || 0;
    const duplicates = response.duplicates || 0;
    const failures = response.failures || 0;
    
    let message = `Batch processed: ${added} added`;
    if (duplicates) {
      message += `, ${duplicates} skipped (duplicate)`;
    }
    if (failures) {
      message += `, ${failures} failed`;
    }
    
    showNotification('Aria2Chrome', message);
    callback?.({ success: true, response });
  });
}

function initializeDirectoryIndexSupport() {
  if (!['http:', 'https:'].includes(window.location.protocol)) {
    notifyDirectoryListingStatus(false, 0);
    return;
  }
  
  if (!hasDirectoryListingHeuristics()) {
    notifyDirectoryListingStatus(false, 0);
    return;
  }
  
  const files = collectDirectoryFilesFromIndex();
  if (!files.length) {
    notifyDirectoryListingStatus(false, 0);
    return;
  }
  
  notifyDirectoryListingStatus(true, files.length);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initializeDirectoryIndexSupport);
} else {
  initializeDirectoryIndexSupport();
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'triggerDirectoryDownloadAll') {
    processDirectoryDownloadAllRequest('context-menu', sendResponse);
    return true;
  }
  
  if (request.action === 'promptFilenameForDownload') {
    (async () => {
      const suggestedName = request.suggestedName || 'download';
      const allowPicker = request.allowFilePicker !== false;
      
      // Prefer file picker when available and allowed
      if (allowPicker && window.isSecureContext && window.showSaveFilePicker) {
        try {
          const fileHandle = await window.showSaveFilePicker({
            suggestedName,
            types: [{
              description: 'All Files',
              accept: {'*/*': []}
            }],
            excludeAcceptAllOption: false
          });
          
          const file = await fileHandle.getFile();
          sendResponse({ success: true, filename: file.name });
          return;
        } catch (error) {
          if (error.name === 'AbortError') {
            sendResponse({ success: false, cancelled: true });
            return;
          }
          // Fall through to prompt fallback on other errors
          console.warn('[Aria2 Downloader] File picker unavailable, falling back to prompt:', error);
        }
      }
      
      // Fallback prompt (works even without secure context)
      const entered = prompt('Enter filename:', suggestedName);
      if (!entered || !entered.trim()) {
        sendResponse({ success: false, cancelled: true });
        return;
      }
      
      sendResponse({ success: true, filename: entered.trim() });
    })();
    
    return true;
  }
});
