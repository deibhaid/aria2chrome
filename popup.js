// Popup script for managing downloads

let downloads = {};

// Format bytes to human-readable format
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format speed
function formatSpeed(bytesPerSecond) {
  return formatBytes(bytesPerSecond) + '/s';
}

// Get status badge class
function getStatusClass(status) {
  switch (status) {
    case 'active': return 'status-active';
    case 'complete': return 'status-complete';
    case 'paused': return 'status-paused';
    case 'error': return 'status-error';
    case 'waiting': return 'status-waiting';
    case 'queued': return 'status-queued';
    case 'awaiting_confirmation': return 'status-waiting';
    default: return 'status-active';
  }
}

// Get status display text
function getStatusText(status) {
  switch (status) {
    case 'active': return 'Downloading';
    case 'complete': return 'Completed';
    case 'paused': return 'Paused';
    case 'error': return 'Failed';
    case 'waiting': return 'Waiting';
    case 'queued': return 'Queued';
    case 'failed_permanently': return 'Failed (Max Retries)';
    case 'removed': return 'Removed';
    case 'awaiting_confirmation': return 'Confirm Filename';
    default: return status;
  }
}

// Calculate progress percentage
function calculateProgress(download) {
  if (!download.totalLength || download.totalLength === '0') return 0;
  const completed = parseInt(download.completedLength || 0);
  const total = parseInt(download.totalLength);
  // Calculate EXACT percentage - don't round up or cap at 100
  const exactProgress = (completed / total) * 100;
  // Round to 4 decimal places for maximum precision (e.g., 99.9456%)
  // This ensures we never show 100% unless it's EXACTLY 100%
  return Math.floor(exactProgress * 10000) / 10000;
}

// Format progress for display (remove trailing zeros)
function formatProgress(progress) {
  if (progress === 0) return '0';
  if (progress === 100) return '100';
  // Show 2 decimal places for precision, remove trailing zeros
  return parseFloat(progress.toFixed(2)).toString();
}

// Render downloads list
function renderDownloads() {
  const downloadsList = document.getElementById('downloadsList');
  const downloadsArray = Object.values(downloads);
  
  if (downloadsArray.length === 0) {
    downloadsList.innerHTML = `
      <div class="empty-state">
        <p>No downloads yet</p>
        <p class="hint">Click on a video link to start downloading</p>
      </div>
    `;
    return;
  }
  
  const statusPriority = {
    awaiting_confirmation: -1,
    active: 0,
    waiting: 1,
    queued: 2,
    paused: 3,
    error: 4,
    failed_permanently: 5,
    removed: 6,
    complete: 7
  };
  
  downloadsArray.sort((a, b) => {
    const priorityA = statusPriority[a.status] !== undefined ? statusPriority[a.status] : 99;
    const priorityB = statusPriority[b.status] !== undefined ? statusPriority[b.status] : 99;
    
    if (priorityA !== priorityB) {
      return priorityA - priorityB;
    }
    
    return (b.addedAt || 0) - (a.addedAt || 0);
  });
  
  downloadsList.innerHTML = downloadsArray.map(download => {
    const progress = calculateProgress(download);
    const statusClass = getStatusClass(download.status);
    const statusText = getStatusText(download.status);
    const speed = download.downloadSpeed ? formatSpeed(parseInt(download.downloadSpeed)) : '';
    const size = download.totalLength ? formatBytes(parseInt(download.totalLength)) : 'Unknown';
    const completed = download.completedLength ? formatBytes(parseInt(download.completedLength)) : '0 B';
    const url = download.url || '';
    const truncatedUrl = url.length > 60 ? url.substring(0, 57) + '...' : url;
    const urlForAttr = url ? encodeURIComponent(url) : '';
    const labelForAttr = encodeURIComponent(truncatedUrl);
    
    return `
      <div class="download-item">
        <div class="download-header">
          <div class="download-filename" title="${download.filename}">
            ${download.filename}
          </div>
          <div class="download-controls">
            ${download.status === 'awaiting_confirmation' ? 
              `<button class="control-btn" data-action="confirmDownload" data-gid="${download.confirmationId || download.gid}" title="Confirm & Start">✓</button>` :
              download.status === 'active' || download.status === 'waiting' ? 
              `<button class="control-btn" data-action="pause" data-gid="${download.gid}" title="Pause">⏸️</button>` : 
              download.status === 'complete' ?
              `<button class="control-btn" data-action="showInFolder" data-gid="${download.gid}" data-filepath="${download.filePath || ''}" title="Show in Folder">📁</button>` :
              download.status === 'queued' ?
              `<button class="control-btn" data-action="startQueued" data-gid="${download.gid || download.queueId}" title="Start Now">▶️</button>` :
              `<button class="control-btn" data-action="resume" data-gid="${download.gid}" title="${download.status === 'failed_permanently' ? 'Retry (Reset Attempts)' : 'Resume'}">▶️</button>`
            }
            <button class="control-btn" data-action="remove" data-gid="${download.gid || download.queueId || download.confirmationId}" title="Remove">🗑️</button>
          </div>
        </div>
        
        ${url ? `<div class="download-url download-url-copy" role="button" tabindex="0" data-full-url="${urlForAttr}" data-label-display="${labelForAttr}" title="Click to copy full URL">${truncatedUrl}</div>` : ''}
        
        ${download.status !== 'complete' ? `
          <div class="progress-bar">
            <div class="progress-fill" style="width: ${progress}%"></div>
          </div>
        ` : ''}
        
        <div class="download-info">
          <div>
            <span class="status-badge ${statusClass}">${statusText}</span>
            ${progress > 0 && download.status !== 'complete' ? `<span title="Exact: ${progress}% (${completed} / ${size})">${formatProgress(progress)}%</span>` : ''}
          </div>
          <div>
            ${speed ? `<span class="download-speed">${speed}</span> • ` : ''}
            <span class="download-size" title="${download.completedLength || 0} / ${download.totalLength || 0} bytes">${completed} / ${size}</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
  
  // Update stats
  const activeCount = downloadsArray.filter(d => d.status === 'active' || d.status === 'waiting').length;
  const completedCount = downloadsArray.filter(d => d.status === 'complete').length;
  
  document.getElementById('activeCount').textContent = activeCount;
  document.getElementById('completedCount').textContent = completedCount;
  document.getElementById('totalCount').textContent = downloadsArray.length;
  
  // Add event listeners to controls
  document.querySelectorAll('.control-btn').forEach(btn => {
    btn.addEventListener('click', handleControlClick);
  });
}

// Handle control button clicks
function handleControlClick(event) {
  const action = event.currentTarget.dataset.action;
  const gid = event.currentTarget.dataset.gid;
  const filepath = event.currentTarget.dataset.filepath;
  
  switch (action) {
    case 'pause':
      pauseDownload(gid);
      break;
    case 'resume':
      resumeDownload(gid);
      break;
    case 'startQueued':
      startQueuedDownload(gid);
      break;
    case 'remove':
      removeDownload(gid);
      break;
    case 'confirmDownload':
      confirmDownload(gid);
      break;
    case 'showInFolder':
      showInFolder(gid, filepath);
      break;
  }
}

// Pause download
function pauseDownload(gid) {
  chrome.runtime.sendMessage({
    action: 'pauseDownload',
    gid: gid
  }, response => {
    if (response && response.success) {
      // Successfully paused (or already paused)
      if (response.message) {
        console.log('[Popup] Pause:', response.message);
      }
      refreshDownloads();
    } else {
      const errorMsg = response?.error || 'Unknown error';
      console.error('[Popup] Failed to pause download:', errorMsg);
      
      // Show user-friendly error for specific cases
      if (errorMsg.includes('already complete')) {
        // Don't show alert for this - just refresh to show correct state
        console.log('[Popup] Download is complete, refreshing UI');
      } else if (errorMsg.includes('error state')) {
        // Don't alert - the UI will show the error state
        console.log('[Popup] Download in error state');
      } else if (errorMsg.includes('not found')) {
        console.log('[Popup] Download not found');
      } else if (errorMsg.includes('aria2c is not running')) {
        alert('Cannot pause: aria2c is not running!\n\nPlease start aria2c and try again.');
      }
      
      refreshDownloads();
    }
  });
}

// Resume download
function resumeDownload(gid) {
  console.log('[Popup] Requesting resume for gid:', gid);
  
  chrome.runtime.sendMessage({
    action: 'resumeDownload',
    gid: gid
  }, response => {
    console.log('[Popup] Resume response:', response);
    
    if (response && response.success) {
      console.log('[Popup] Resume successful');
      refreshDownloads();
    } else {
      const errorMsg = response?.error || 'Unknown error - no response from background script';
      console.error('[Popup] Failed to resume download:', errorMsg);
      
      // Show user-friendly error message
      if (errorMsg.includes('aria2c is not running') || errorMsg.includes('not accessible')) {
        alert('Cannot resume: aria2c is not running or not accessible!\n\nError: ' + errorMsg);
      } else if (errorMsg.includes('HTTP error! status: 400') || errorMsg.includes('HTTP error! status: 403') || errorMsg.includes('HTTP error! status: 404')) {
        alert('Cannot resume: Download link has expired!\n\n' +
              'The server is rejecting the request (HTTP error).\n' +
              'This usually happens when download links expire.\n\n' +
              'Solution: Visit the website again and start a fresh download.\n\n' +
              'Error: ' + errorMsg);
      } else {
        alert('Failed to resume download:\n\n' + errorMsg + '\n\nCheck browser console (F12) for details.');
      }
      
      refreshDownloads();
    }
  });
}

// Start a queued download manually
function startQueuedDownload(queueId) {
  chrome.runtime.sendMessage({
    action: 'startQueuedDownload',
    queueId: queueId
  }, response => {
    if (response && response.success) {
      refreshDownloads();
    } else {
      console.error('Failed to start queued download:', response?.error);
      refreshDownloads();
    }
  });
}

// Remove download
function removeDownload(gid) {
  const download = downloads[gid];
  
  // If awaiting_confirmation, send cancellation instead
  if (download && download.status === 'awaiting_confirmation') {
    chrome.runtime.sendMessage({
      action: 'cancelConfirmation',
      confirmationId: gid
    }, response => {
      refreshDownloads();
    });
    return;
  }
  
  chrome.runtime.sendMessage({
    action: 'removeDownload',
    gid: gid
  }, response => {
    if (response && response.success) {
      refreshDownloads();
    } else {
      console.error('Failed to remove download:', response?.error);
      // Refresh anyway to update UI
      refreshDownloads();
    }
  });
}

// Show file in folder
function showInFolder(gid, filepath) {
  if (!filepath) {
    // If no filepath, try to get it from downloads
    const download = downloads[gid];
    filepath = download?.filePath;
  }
  
  if (!filepath) {
    alert('File path not available. The file location is unknown.');
    return;
  }
  
  chrome.runtime.sendMessage({
    action: 'showInFolder',
    gid: gid,
    filepath: filepath
  }, response => {
    if (response && !response.success) {
      alert('Could not open file location: ' + (response.error || 'Unknown error'));
    }
  });
}

async function confirmDownload(confirmationId) {
  const download = downloads[confirmationId];
  if (!download || download.status !== 'awaiting_confirmation') {
    alert('Confirmation request expired or invalid');
    refreshDownloads();
    return;
  }
  
  try {
    // Check if File System Access API is available
    if (!window.showSaveFilePicker) {
      // Fallback to simple prompt
      const currentName = download.filename || '';
      const confirmedName = prompt('Confirm filename (or edit):', currentName);
      
      if (!confirmedName || !confirmedName.trim()) {
        cancelConfirmation(confirmationId);
        return;
      }
      
      startDownloadWithFilename(confirmationId, confirmedName.trim(), null);
      return;
    }
    
    // Open native file picker
    const suggestedName = download.filename || 'download';
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: suggestedName,
      types: [{
        description: 'All Files',
        accept: {'*/*': []}
      }],
      excludeAcceptAllOption: false
    });
    
    // Get the selected path and filename
    const file = await fileHandle.getFile();
    const selectedFilename = file.name;
    
    // Get directory path (we'll pass to background to extract directory)
    startDownloadWithFilename(confirmationId, selectedFilename, fileHandle);
    
  } catch (error) {
    if (error.name === 'AbortError') {
      // User cancelled the file picker
      console.log('File picker cancelled by user');
      return;
    }
    console.error('File picker error:', error);
    alert('Failed to open file picker: ' + error.message);
  }
}

function startDownloadWithFilename(confirmationId, filename, fileHandle) {
  chrome.runtime.sendMessage({
    action: 'confirmDownload',
    confirmationId: confirmationId,
    filename: filename,
    hasFileHandle: !!fileHandle
  }, response => {
    if (response && response.success) {
      refreshDownloads();
    } else {
      alert('Failed to start download: ' + (response?.error || 'Unknown error'));
      refreshDownloads();
    }
  });
}

function cancelConfirmation(confirmationId) {
  chrome.runtime.sendMessage({
    action: 'cancelConfirmation',
    confirmationId: confirmationId
  }, () => {
    refreshDownloads();
  });
}

// Refresh downloads
function refreshDownloads() {
  chrome.runtime.sendMessage({ action: 'getDownloads' }, response => {
    if (response && response.downloads) {
      downloads = response.downloads;
      renderDownloads();
    }
  });
}

function clearCompletedDownloads() {
  chrome.runtime.sendMessage({ action: 'clearCompletedDownloads' }, response => {
    if (response && response.success) {
      refreshDownloads();
    }
  });
}

function openManualModal() {
  document.getElementById('manualModal').classList.remove('hidden');
  const textarea = document.getElementById('manualUrls');
  textarea.value = '';
  textarea.focus();
}

function closeManualModal() {
  document.getElementById('manualModal').classList.add('hidden');
}

function submitManualDownloads() {
  const textarea = document.getElementById('manualUrls');
  const input = textarea.value;
  if (!input || !input.trim()) {
    closeManualModal();
    return;
  }
  
  const urls = input
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(Boolean);
  
  if (urls.length === 0) {
    closeManualModal();
    return;
  }
  
  closeManualModal();
  
  // Process each URL with file picker (no pre-specified filenames)
  processManualDownloadsWithPicker(urls, [], 0);
}

async function processManualDownloadsWithPicker(urls, names, index) {
  if (index >= urls.length) {
    refreshDownloads();
    return;
  }
  
  const url = urls[index];
  const suggestedName = names[index] || getFilenameFromUrl(url);
  
  try {
    // Check if File System Access API is available
    if (!window.showSaveFilePicker) {
      // Fallback: add with suggested name
      chrome.runtime.sendMessage({
        action: 'manualAddDownload',
        url: url,
        filename: suggestedName,
        skipConfirmation: false
      }, () => {
        // Process next URL
        processManualDownloadsWithPicker(urls, names, index + 1);
      });
      return;
    }
    
    // Open native file picker
    const fileHandle = await window.showSaveFilePicker({
      suggestedName: suggestedName,
      types: [{
        description: 'All Files',
        accept: {'*/*': []}
      }],
      excludeAcceptAllOption: false
    });
    
    const file = await fileHandle.getFile();
    const selectedFilename = file.name;
    
    // Add download with confirmed filename
    chrome.runtime.sendMessage({
      action: 'manualAddDownload',
      url: url,
      filename: selectedFilename,
      skipConfirmation: true
    }, response => {
      if (response && !response.success && !response.duplicate) {
        console.error('Failed to add download:', response.error);
      }
      // Process next URL
      processManualDownloadsWithPicker(urls, names, index + 1);
    });
    
  } catch (error) {
    if (error.name === 'AbortError') {
      // User cancelled - skip this download
      console.log('File picker cancelled, skipping:', url);
      processManualDownloadsWithPicker(urls, names, index + 1);
    } else {
      console.error('File picker error:', error);
      alert('Failed to open file picker for: ' + url + '\nError: ' + error.message);
      // Continue with next URL
      processManualDownloadsWithPicker(urls, names, index + 1);
    }
  }
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

// Open settings
function openSettings() {
  chrome.runtime.openOptionsPage();
}

// Open history
function openHistory() {
  chrome.tabs.create({ url: 'history.html' });
}

// Toggle interception
function toggleInterception() {
  chrome.runtime.sendMessage({ action: 'toggleInterception' }, response => {
    if (response && response.success) {
      updateToggleButton(response.enabled);
    }
  });
}

// Update toggle button appearance
function updateToggleButton(enabled) {
  const toggleBtn = document.getElementById('toggleInterceptionBtn');
  
  if (enabled) {
    toggleBtn.classList.add('enabled');
    toggleBtn.classList.remove('disabled');
    toggleBtn.title = 'Interception Enabled - Click to disable';
  } else {
    toggleBtn.classList.add('disabled');
    toggleBtn.classList.remove('enabled');
    toggleBtn.title = 'Interception Disabled - Click to enable';
  }
}

// Load interception state
function loadInterceptionState() {
  chrome.runtime.sendMessage({ action: 'getInterceptionState' }, response => {
    if (response) {
      updateToggleButton(response.enabled);
    }
  });
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  refreshDownloads();
  loadInterceptionState();
  
  // Set up auto-refresh
  setInterval(refreshDownloads, 1000);
  
  // Event listeners
  document.getElementById('refreshBtn').addEventListener('click', refreshDownloads);
  document.getElementById('settingsBtn').addEventListener('click', openSettings);
  document.getElementById('historyBtn').addEventListener('click', openHistory);
  document.getElementById('toggleInterceptionBtn').addEventListener('click', toggleInterception);
  document.getElementById('clearCompletedBtn').addEventListener('click', clearCompletedDownloads);
  document.getElementById('addUrlBtn').addEventListener('click', openManualModal);
  document.getElementById('cancelManualBtn').addEventListener('click', closeManualModal);
  document.getElementById('submitManualBtn').addEventListener('click', submitManualDownloads);
  document.getElementById('manualModal').addEventListener('click', (e) => {
    if (e.target.id === 'manualModal') {
      closeManualModal();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      closeManualModal();
    }
  });

  const downloadsListEl = document.getElementById('downloadsList');
  downloadsListEl.addEventListener('click', handleDownloadUrlClick);
  downloadsListEl.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const el = e.target.closest('.download-url-copy');
    if (!el) return;
    e.preventDefault();
    copyFullUrlFromRow(el);
  });
});

/** Copy full download URL from a .download-url-copy row (click handler). */
function handleDownloadUrlClick(e) {
  const el = e.target.closest('.download-url-copy');
  if (!el) return;
  e.preventDefault();
  e.stopPropagation();
  copyFullUrlFromRow(el);
}

async function copyFullUrlFromRow(el) {
  const encoded = el.dataset.fullUrl;
  if (!encoded) return;
  let fullUrl;
  try {
    fullUrl = decodeURIComponent(encoded);
  } catch (err) {
    console.warn('[Popup] Bad URL data:', err);
    return;
  }
  const labelEncoded = el.dataset.labelDisplay || '';
  let restoreText;
  try {
    restoreText = labelEncoded ? decodeURIComponent(labelEncoded) : el.textContent;
  } catch (err) {
    restoreText = el.textContent;
  }

  if (el._copyRestoreTimer) {
    clearTimeout(el._copyRestoreTimer);
    el._copyRestoreTimer = null;
  }

  const ok = await copyTextToClipboard(fullUrl);
  if (!ok) {
    return;
  }
  el.textContent = 'Copied!';
  el.classList.add('download-url-copied');
  el._copyRestoreTimer = window.setTimeout(() => {
    el.textContent = restoreText;
    el.classList.remove('download-url-copied');
    el._copyRestoreTimer = null;
  }, 1500);
}

async function copyTextToClipboard(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (err) {
    console.warn('[Popup] clipboard.writeText failed:', err);
  }
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch (err) {
    console.warn('[Popup] execCommand copy failed:', err);
    return false;
  }
}
