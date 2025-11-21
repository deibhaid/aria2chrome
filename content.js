// Content script to intercept file downloads

let interceptionEnabled = true; // Track if interception is enabled
const DIRECTORY_BUTTON_ID = 'aria2chrome-directory-download-btn';
const DIRECTORY_STYLE_ID = 'aria2chrome-directory-download-style';

// Default extensions (video files + archives)
let FILE_EXTENSIONS = [
  // Video files
  '.mp4', '.mkv', '.avi', '.mov', '.wmv', '.flv', '.webm', '.m4v', '.mpg', '.mpeg',
  '.3gp', '.ogv', '.ts', '.m3u8', '.f4v', '.vob', '.rm', '.rmvb',
  // Archive files
  '.rar', '.zip', '.7z', '.tar', '.gz', '.bz2', '.xz', '.tar.gz', '.tar.bz2', '.tar.xz',
  '.tgz', '.tbz2', '.txz', '.z', '.lz', '.lzma', '.cab', '.iso', '.dmg'
];

// Load custom extensions and interception state from storage
chrome.storage.sync.get(['fileExtensions', 'interceptionEnabled'], function(result) {
  if (result.fileExtensions && result.fileExtensions.length > 0) {
    FILE_EXTENSIONS = result.fileExtensions;
    console.log('[Aria2 Downloader] Loaded file extensions:', FILE_EXTENSIONS);
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
  if (namespace === 'sync' && changes.interceptionEnabled) {
    interceptionEnabled = changes.interceptionEnabled.newValue;
    console.log('[Aria2 Downloader] Interception toggled:', interceptionEnabled);
  }
});

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
      
      // For domain names, check if it's a direct download link
      const isDirectDownload = 
        downloadAttr || // Has download attribute = definite download
        pathname.includes('/files/') ||
        pathname.includes('/get/') ||
        pathname.includes('/dl/') ||
        pathname.includes('/download/') ||
        pathname.includes('/media/') ||
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
    return downloadAttr.trim();
  }
  
  // Try to extract filename from link text if it contains extension
  if (linkText) {
    const extensionPattern = FILE_EXTENSIONS.map(ext => ext.replace('.', '\\.')).join('|');
    const regex = new RegExp(`([^\\\\/]+\\.(${extensionPattern.replace(/\\\./g, '')}))`, 'i');
    const match = linkText.match(regex);
    if (match) {
      return match[1].trim();
    }
  }
  
  // Try to extract from URL path
  try {
    const urlObj = new URL(url, window.location.href);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();
    
    // If we got a meaningful filename from URL, use it
    if (filename && FILE_EXTENSIONS.some(ext => filename.toLowerCase().endsWith(ext.toLowerCase()))) {
      return filename;
    }
  } catch (e) {
    // Continue to fallback
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
  
  // Traverse up to find anchor tag or button
  while (target && target.tagName !== 'A' && target.tagName !== 'BUTTON') {
    target = target.parentElement;
  }
  
  console.log('[Aria2 Downloader] After traversal, target:', target ? target.tagName : 'null');
  
  // Handle link clicks
  if (target && target.tagName === 'A') {
    const href = target.href;
    const downloadAttr = target.getAttribute('download') || '';
    const linkText = target.textContent || target.innerText || '';
    
    // Debug logging
    console.log('[Aria2 Downloader] Link clicked:', {
      href: href,
      downloadAttr: downloadAttr,
      linkText: linkText,
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
      
      console.log('[Aria2 Downloader] Intercepted video download:', {
        url: href,
        filename: filename,
        downloadAttr: downloadAttr
      });
      
      // Send message to background script
      chrome.runtime.sendMessage({
        action: 'captureVideo',
        url: href,
        filename: filename,
        pageUrl: window.location.href,
        pageTitle: document.title
      }, function(response) {
        if (response && response.success) {
          // Show notification
          if (!response.duplicate) {
            showNotification('Download added', `${filename} added to aria2 queue`);
          }
        } else if (response && response.duplicate) {
          // Don't show error for duplicates, just skip silently
          console.log('[Aria2 Downloader] Duplicate download skipped');
        } else {
          showNotification('Error', response?.error || 'Failed to add to aria2 queue');
        }
      });
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
      
      chrome.runtime.sendMessage({
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
      chrome.runtime.sendMessage({
        action: 'storeContextUrl',
        url: url,
        filename: getFilenameFromUrl(url, downloadAttr, linkText)
      });
    }
  }
});

// ----- HTTP Directory Index Support -----

function ensureDirectoryButtonStyles() {
  if (document.getElementById(DIRECTORY_STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = DIRECTORY_STYLE_ID;
  style.textContent = `
    #${DIRECTORY_BUTTON_ID} {
      position: fixed;
      bottom: 24px;
      right: 24px;
      z-index: 2147483647;
      background: #0d6efd;
      color: #fff;
      border: none;
      border-radius: 999px;
      padding: 12px 20px;
      font-size: 14px;
      font-weight: 600;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      box-shadow: 0 8px 20px rgba(13, 110, 253, 0.35);
      cursor: pointer;
      transition: transform 0.1s ease, box-shadow 0.1s ease, background 0.1s ease;
    }
    
    #${DIRECTORY_BUTTON_ID}:hover {
      background: #0b5ed7;
      transform: translateY(-1px);
      box-shadow: 0 10px 24px rgba(13, 110, 253, 0.4);
    }
    
    #${DIRECTORY_BUTTON_ID}:active {
      transform: translateY(1px);
      box-shadow: 0 6px 16px rgba(13, 110, 253, 0.35);
    }
  `;
  const target = document.head || document.documentElement || document.body;
  if (target) {
    target.appendChild(style);
  }
}

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
    const filename = decodeURIComponent(filenameSegment || link.textContent || `file-${files.size + 1}`).trim();
    
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
  try {
    if (chrome?.runtime?.sendMessage) {
      chrome.runtime.sendMessage({
        action: 'directoryListingStatus',
        hasListing,
        fileCount
      });
    }
  } catch (e) {
    // Ignore messaging errors (e.g., extension reloading)
  }
}

function injectDirectoryDownloadButton(fileCount) {
  if (document.getElementById(DIRECTORY_BUTTON_ID)) {
    const existing = document.getElementById(DIRECTORY_BUTTON_ID);
    existing.textContent = `Aria2Chrome Download All (${fileCount})`;
    return;
  }
  
  ensureDirectoryButtonStyles();
  
  const button = document.createElement('button');
  button.id = DIRECTORY_BUTTON_ID;
  button.type = 'button';
  button.textContent = `Aria2Chrome Download All (${fileCount})`;
  button.title = 'Send every file in this directory listing to aria2 via JSON-RPC';
  button.addEventListener('click', handleDirectoryDownloadAllClick);
  
  document.body.appendChild(button);
}

function processDirectoryDownloadAllRequest(triggerSource = 'button', callback) {
  const files = collectDirectoryFilesFromIndex();
  
  if (!files.length) {
    showNotification('Aria2Chrome', 'No downloadable files detected in this directory.');
    callback?.({ success: false, reason: 'no_files' });
    return;
  }
  
  showNotification('Aria2Chrome', `Sending ${files.length} file(s) to aria2...`);
  
  chrome.runtime.sendMessage({
    action: 'downloadMultiple',
    downloads: files.map(file => ({
      url: file.url,
      filename: file.filename,
      pageUrl: window.location.href,
      pageTitle: document.title,
      source: triggerSource
    }))
  }, response => {
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

function handleDirectoryDownloadAllClick() {
  processDirectoryDownloadAllRequest('floating-button');
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
  injectDirectoryDownloadButton(files.length);
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
});
