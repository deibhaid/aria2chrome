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
      
      if (isIPAddress || isLocalhost) {
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
  let target = event.target;
  
  // Traverse up to find anchor tag
  while (target && target.tagName !== 'A') {
    target = target.parentElement;
  }
  
  if (target && target.tagName === 'A') {
    const href = target.href;
    const downloadAttr = target.getAttribute('download') || '';
    const linkText = target.textContent || target.innerText || '';
    
    if (isVideoUrl(href, downloadAttr, linkText, target)) {
      // Don't intercept if disabled
      if (!interceptionEnabled) {
        console.log('[Aria2 Downloader] Interception disabled, allowing browser download');
        return;
      }
      
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
