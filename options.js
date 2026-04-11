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

let selectedExtensions = [];
let customExtensions = [];

// Load saved settings
async function loadSettings() {
  const result = await chrome.storage.sync.get(['aria2Config', 'fileExtensions', 'customFileExtensions', 'autoResume', 'showNotifications']);
  
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
  document.getElementById('showNotifications').checked = result.showNotifications === true;
  
  // Render extension checkboxes
  renderExtensions();
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
  
  try {
    await chrome.storage.sync.set({ 
      aria2Config: config,
      fileExtensions: selectedExtensions,
      customFileExtensions: customExtensions,
      autoResume: autoResumeValue,
      showNotifications: showNotificationsValue
    });
    
    // Notify background script to reload config
    chrome.runtime.sendMessage({ action: 'updateConfig', config }, response => {
      showSaveStatus('Settings saved successfully!', 'success');
    });
    
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
    document.getElementById('showNotifications').checked = false;
    
    selectedExtensions = [...DEFAULT_EXTENSIONS];
    customExtensions = [];
    renderExtensions();
    
    showSaveStatus('Settings reset to defaults. Click Save to apply.', 'success');
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
  
  // Event listeners
  document.getElementById('saveBtn').addEventListener('click', saveSettings);
  document.getElementById('resetBtn').addEventListener('click', resetSettings);
  document.getElementById('testBtn').addEventListener('click', testConnection);
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
