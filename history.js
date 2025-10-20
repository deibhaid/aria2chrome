// History page script

let downloads = {};

// Format bytes to human-readable format
function formatBytes(bytes) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Format date
function formatDate(timestamp) {
  if (!timestamp) return 'Unknown';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  // Less than 1 hour
  if (diff < 3600000) {
    const minutes = Math.floor(diff / 60000);
    return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  }
  
  // Less than 24 hours
  if (diff < 86400000) {
    const hours = Math.floor(diff / 3600000);
    return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  }
  
  // Less than 7 days
  if (diff < 604800000) {
    const days = Math.floor(diff / 86400000);
    return `${days} day${days === 1 ? '' : 's'} ago`;
  }
  
  // Format as date
  return date.toLocaleDateString() + ' ' + date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// Get status class
function getStatusClass(status) {
  switch (status) {
    case 'active': return 'status-active';
    case 'complete': return 'status-complete';
    case 'paused': return 'status-paused';
    case 'error': return 'status-error';
    case 'waiting': return 'status-waiting';
    default: return 'status-active';
  }
}

// Get status text
function getStatusText(status) {
  switch (status) {
    case 'active': return 'Downloading';
    case 'complete': return 'Completed';
    case 'paused': return 'Paused';
    case 'error': return 'Failed';
    case 'waiting': return 'Waiting';
    default: return status;
  }
}

// Render history
function renderHistory() {
  const historyList = document.getElementById('historyList');
  const downloadsArray = Object.values(downloads);
  
  if (downloadsArray.length === 0) {
    historyList.innerHTML = `
      <div class="empty-state">
        <p>📭 No download history yet</p>
        <p class="hint">Downloads will appear here once you start downloading files</p>
      </div>
    `;
    updateStats(0, 0, 0);
    return;
  }
  
  // Sort by added time (newest first)
  downloadsArray.sort((a, b) => (b.addedAt || 0) - (a.addedAt || 0));
  
  historyList.innerHTML = downloadsArray.map(download => {
    const url = download.url || '';
    const truncatedUrl = url.length > 80 ? url.substring(0, 77) + '...' : url;
    const statusClass = getStatusClass(download.status);
    const statusText = getStatusText(download.status);
    const size = download.totalLength ? formatBytes(parseInt(download.totalLength)) : 'Unknown size';
    const date = formatDate(download.addedAt);
    
    return `
      <div class="history-item" data-gid="${download.gid}">
        <div class="history-info">
          <div class="history-filename">${download.filename || 'Unknown file'}</div>
          ${url ? `<div class="history-url" title="${url}">${truncatedUrl}</div>` : ''}
          <div class="history-meta">
            <span class="file-size">${size}</span>
            <span class="download-date">${date}</span>
          </div>
        </div>
        <div class="history-actions">
          <span class="status-badge ${statusClass}">${statusText}</span>
          <button class="delete-btn" data-gid="${download.gid}" title="Delete from history">✕</button>
        </div>
      </div>
    `;
  }).join('');
  
  // Calculate stats
  const completed = downloadsArray.filter(d => d.status === 'complete').length;
  const failed = downloadsArray.filter(d => d.status === 'error').length;
  updateStats(downloadsArray.length, completed, failed);
  
  // Add event listeners to delete buttons
  document.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', handleDelete);
  });
}

// Update stats
function updateStats(total, completed, failed) {
  document.getElementById('totalDownloads').textContent = total;
  document.getElementById('completedDownloads').textContent = completed;
  document.getElementById('failedDownloads').textContent = failed;
}

// Handle delete
function handleDelete(event) {
  const gid = event.currentTarget.dataset.gid;
  
  // Show confirmation
  showConfirmDialog(
    'Delete Download',
    'Are you sure you want to remove this download from history?',
    () => {
      chrome.runtime.sendMessage({
        action: 'removeDownload',
        gid: gid
      }, response => {
        if (response && response.success) {
          loadHistory();
        }
      });
    }
  );
}

// Show confirmation dialog
function showConfirmDialog(title, message, onConfirm) {
  const overlay = document.createElement('div');
  overlay.className = 'confirm-overlay';
  overlay.innerHTML = `
    <div class="confirm-dialog">
      <h2>${title}</h2>
      <p>${message}</p>
      <div class="confirm-actions">
        <button class="btn btn-cancel">Cancel</button>
        <button class="btn btn-confirm">Confirm</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(overlay);
  
  const cancelBtn = overlay.querySelector('.btn-cancel');
  const confirmBtn = overlay.querySelector('.btn-confirm');
  
  const close = () => overlay.remove();
  
  cancelBtn.addEventListener('click', close);
  confirmBtn.addEventListener('click', () => {
    close();
    onConfirm();
  });
  
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

// Clear all history
function clearAllHistory() {
  showConfirmDialog(
    'Clear All History',
    'This will remove all completed and failed downloads from history. Active and paused downloads will not be affected. Are you sure?',
    () => {
      chrome.runtime.sendMessage({
        action: 'clearHistory'
      }, response => {
        if (response && response.success) {
          loadHistory();
        }
      });
    }
  );
}

// Load history
function loadHistory() {
  chrome.runtime.sendMessage({ action: 'getDownloads' }, response => {
    if (response && response.downloads) {
      downloads = response.downloads;
      renderHistory();
    }
  });
}

// Go back to popup
function goBack() {
  window.close();
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadHistory();
  
  // Set up auto-refresh
  setInterval(loadHistory, 2000);
  
  // Event listeners
  document.getElementById('clearHistoryBtn').addEventListener('click', clearAllHistory);
  document.getElementById('backBtn').addEventListener('click', goBack);
});

