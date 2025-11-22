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
    
    return `
      <div class="download-item">
        <div class="download-header">
          <div class="download-filename" title="${download.filename}">
            ${download.filename}
          </div>
          <div class="download-controls">
            ${download.status === 'active' || download.status === 'waiting' ? 
              `<button class="control-btn" data-action="pause" data-gid="${download.gid}" title="Pause">⏸️</button>` : 
              download.status === 'complete' ?
              `<button class="control-btn" data-action="showInFolder" data-gid="${download.gid}" data-filepath="${download.filePath || ''}" title="Show in Folder">📁</button>` :
              download.status === 'queued' ?
              `<button class="control-btn" data-action="startQueued" data-gid="${download.gid || download.queueId}" title="Start Now">▶️</button>` :
              `<button class="control-btn" data-action="resume" data-gid="${download.gid}" title="${download.status === 'failed_permanently' ? 'Retry (Reset Attempts)' : 'Resume'}">▶️</button>`
            }
            <button class="control-btn" data-action="remove" data-gid="${download.gid || download.queueId}" title="Remove">🗑️</button>
          </div>
        </div>
        
        ${url ? `<div class="download-url" title="${url}">${truncatedUrl}</div>` : ''}
        
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
      refreshDownloads();
    } else {
      console.error('Failed to pause download:', response?.error);
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

function promptManualDownload() {
  const input = prompt('Enter one or more direct download URLs (one per line):');
  if (!input || !input.trim()) {
    return;
  }
  
  const urls = input
    .split(/\s+/)
    .map(line => line.trim())
    .filter(Boolean);
  
  if (urls.length === 0) {
    return;
  }
  
  chrome.runtime.sendMessage({
    action: 'manualAddDownloads',
    urls
  }, response => {
    if (response && response.success) {
      alert(`Processed ${response.total} link(s).\nAdded: ${response.added}\nDuplicates: ${response.duplicates}\nFailures: ${response.failures}`);
      refreshDownloads();
    } else {
      alert('Failed to add downloads: ' + (response?.error || 'Unknown error'));
    }
  });
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
  document.getElementById('addUrlBtn').addEventListener('click', promptManualDownload);
});
