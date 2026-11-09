import type {
  ActionResult,
  ServiceItem,
  ServiceScope,
  ServiceStateFilter,
  SystemInfo,
} from './types';
import './index.css';

// Application State
let currentScope: ServiceScope = 'system';
let currentFilter: ServiceStateFilter = 'running';
let searchQuery = '';
let servicesList: ServiceItem[] = [];
let isLoading = false;
const pendingActions = new Set<string>();
let autoRefreshTimer: ReturnType<typeof setInterval> | null = null;
let toastTimeout: ReturnType<typeof setTimeout> | null = null;

// DOM Elements
const tabSystem = document.getElementById('tab-system') as HTMLButtonElement;
const tabUser = document.getElementById('tab-user') as HTMLButtonElement;
const envBadge = document.getElementById('env-badge') as HTMLDivElement;
const envBadgeText = document.getElementById(
  'env-badge-text',
) as HTMLSpanElement;

const searchInput = document.getElementById('search-input') as HTMLInputElement;
const searchClear = document.getElementById(
  'search-clear',
) as HTMLButtonElement;

const filterBtns = document.querySelectorAll<HTMLButtonElement>('.filter-btn');
const countRunning = document.getElementById(
  'count-running',
) as HTMLSpanElement;
const countStopped = document.getElementById(
  'count-stopped',
) as HTMLSpanElement;
const countAll = document.getElementById('count-all') as HTMLSpanElement;

const autoRefreshCheck = document.getElementById(
  'auto-refresh-check',
) as HTMLInputElement;
const btnRefresh = document.getElementById('btn-refresh') as HTMLButtonElement;
const refreshIcon = document.getElementById('refresh-icon') as HTMLElement;

const summaryText = document.getElementById('summary-text') as HTMLSpanElement;
const servicesContainer = document.getElementById(
  'services-container',
) as HTMLElement;

const toast = document.getElementById('toast') as HTMLDivElement;
const toastMessage = document.getElementById(
  'toast-message',
) as HTMLSpanElement;
const toastIcon = document.getElementById('toast-icon') as HTMLSpanElement;
const toastClose = document.getElementById('toast-close') as HTMLButtonElement;

/**
 * Format raw byte count into human-readable memory string
 */
function formatBytes(bytes?: number): string {
  if (bytes === undefined || bytes === null || isNaN(bytes) || bytes <= 0) {
    return '0 B';
  }
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = bytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex++;
  }
  return `${size.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

/**
 * Display a feedback toast notification
 */
function showToast(
  type: 'success' | 'error',
  message: string,
  duration = 5000,
): void {
  if (toastTimeout) {
    clearTimeout(toastTimeout);
  }

  toast.className = `toast ${type}`;
  toastIcon.textContent = type === 'success' ? '✓' : '⚠️';
  toastMessage.textContent = message;

  toastTimeout = setTimeout(() => {
    toast.className = 'toast hidden';
  }, duration);
}

toastClose.addEventListener('click', () => {
  if (toastTimeout) clearTimeout(toastTimeout);
  toast.className = 'toast hidden';
});

/**
 * Initialize system information in the header
 */
async function initSystemInfo(): Promise<void> {
  try {
    const info: SystemInfo = await window.servicesAPI.getSystemInfo();
    if (info.isElevated) {
      envBadge.className = 'env-badge elevated';
      envBadgeText.textContent = 'Root / Elevated';
    } else {
      envBadge.className = 'env-badge';
      const polkitStr = info.hasPolkit ? ' (Polkit)' : '';
      envBadgeText.textContent = `User: ${info.user}${polkitStr}`;
    }
  } catch (err) {
    console.warn('Could not read system info:', err);
    envBadgeText.textContent = 'Linux Environment';
  }
}

/**
 * Copy text to clipboard with temporary button animation
 */
async function copyToClipboard(
  text: string,
  btn: HTMLButtonElement,
): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    const originalText = btn.innerHTML;
    btn.innerHTML = `<span style="color:#34d399;font-size:0.75rem;">✓ Copied</span>`;
    setTimeout(() => {
      btn.innerHTML = originalText;
    }, 1800);
  } catch {
    showToast('error', 'Failed to copy path to clipboard.');
  }
}

/**
 * Execute start/stop/restart for a service
 */
async function handleServiceAction(
  action: 'start' | 'stop' | 'restart',
  service: ServiceItem,
): Promise<void> {
  if (pendingActions.has(service.name)) return;

  pendingActions.add(service.name);
  renderServices(); // update button state to loading

  try {
    let result: ActionResult;
    if (action === 'start') {
      result = await window.servicesAPI.startService(
        service.name,
        currentScope,
      );
    } else if (action === 'stop') {
      result = await window.servicesAPI.stopService(service.name, currentScope);
    } else {
      result = await window.servicesAPI.restartService(
        service.name,
        currentScope,
      );
    }

    if (result.success) {
      showToast('success', result.message || `Action ${action} succeeded.`);
    } else {
      showToast(
        'error',
        result.error || `Failed to ${action} ${service.name}.`,
        8000,
      );
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast('error', `Error executing ${action}: ${msg}`, 8000);
  } finally {
    pendingActions.delete(service.name);
    await loadServices(false);
  }
}

/**
 * Render the filtered list of services into the DOM
 */
function renderServices(): void {
  const query = searchQuery.trim().toLowerCase();

  const filtered = servicesList.filter((s) => {
    if (!query) return true;
    return (
      s.name.toLowerCase().includes(query) ||
      s.description.toLowerCase().includes(query) ||
      s.fragmentPath.toLowerCase().includes(query) ||
      (s.execStart && s.execStart.toLowerCase().includes(query)) ||
      (s.mainPid && String(s.mainPid).includes(query))
    );
  });

  // Calculate aggregate RAM usage and active processes
  const totalMemoryBytes = filtered.reduce(
    (acc, s) => acc + (s.memoryBytes || 0),
    0,
  );
  const activeProcessesCount = filtered.filter(
    (s) => s.mainPid && s.mainPid > 0,
  ).length;

  // Update summary header
  summaryText.innerHTML = `Showing <strong>${filtered.length}</strong> of ${servicesList.length} services (${currentScope} scope) &bull; RAM Consumed: <strong style="color:#7dd3fc">${formatBytes(totalMemoryBytes)}</strong> &bull; Active Processes: <strong style="color:#d8b4fe">${activeProcessesCount}</strong>`;

  if (isLoading && servicesList.length === 0) {
    servicesContainer.innerHTML = `
      <div class="state-box">
        <div class="spinner"></div>
        <h3>Loading services...</h3>
        <p>Querying systemctl for active services, RAM consumption, and process metrics.</p>
      </div>
    `;
    return;
  }

  if (filtered.length === 0) {
    if (query) {
      servicesContainer.innerHTML = `
        <div class="state-box">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            <line x1="8" y1="11" x2="14" y2="11"></line>
          </svg>
          <h3>No matching services</h3>
          <p>No services found matching "<strong>${escapeHtml(query)}</strong>".</p>
          <button id="btn-clear-empty" class="btn btn-secondary" style="margin-top:0.5rem;">Clear search</button>
        </div>
      `;
      document
        .getElementById('btn-clear-empty')
        ?.addEventListener('click', () => {
          searchInput.value = '';
          searchQuery = '';
          searchClear.classList.add('hidden');
          renderServices();
        });
    } else {
      servicesContainer.innerHTML = `
        <div class="state-box">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <rect x="2" y="2" width="20" height="8" rx="2" ry="2"></rect>
            <rect x="2" y="14" width="20" height="8" rx="2" ry="2"></rect>
          </svg>
          <h3>No services found</h3>
          <p>No services are currently in this state under ${currentScope} scope.</p>
        </div>
      `;
    }
    return;
  }

  // Build HTML for cards
  let html = '';
  for (const s of filtered) {
    const isRunning = s.subState === 'running';
    const isPending = pendingActions.has(s.name);

    let badgeClass = 'inactive';
    let badgeText = s.subState;
    if (isRunning) {
      badgeClass = 'running';
      badgeText = 'Running';
    } else if (s.activeState === 'failed' || s.subState === 'failed') {
      badgeClass = 'failed';
      badgeText = 'Failed';
    } else if (s.subState === 'dead' || s.subState === 'exited') {
      badgeClass = 'inactive';
      badgeText = s.subState === 'exited' ? 'Exited' : 'Stopped';
    }

    html += `
      <div class="service-card" data-service="${escapeHtml(s.name)}">
        <div class="card-top">
          <div class="service-identity">
            <span class="service-name">${escapeHtml(s.name)}</span>
            <span class="service-badge ${badgeClass}">
              <span class="badge-dot"></span>
              ${badgeText}
            </span>

            <!-- RAM Usage Badge -->
            ${
              isRunning && s.memoryFormatted
                ? `
              <span class="service-stat memory" title="Current Resident RAM Consumed">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M6 19v2"/><path d="M10 19v2"/><path d="M14 19v2"/><path d="M18 19v2"/>
                  <rect x="4" y="4" width="16" height="15" rx="2"/>
                  <line x1="8" y1="9" x2="16" y2="9"/><line x1="8" y1="13" x2="16" y2="13"/>
                </svg>
                ${escapeHtml(s.memoryFormatted)}
              </span>
            `
                : ''
            }

            <!-- Process / PID Badge -->
            ${
              isRunning && s.mainPid
                ? `
              <span class="service-stat pid" title="Main Process ID and Task/Thread Count">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="4" y="4" width="16" height="16" rx="2"/>
                  <rect x="9" y="9" width="6" height="6"/>
                  <line x1="9" y1="1" x2="9" y2="4"/><line x1="15" y1="1" x2="15" y2="4"/>
                  <line x1="9" y1="20" x2="9" y2="23"/><line x1="15" y1="20" x2="15" y2="23"/>
                  <line x1="20" y1="9" x2="23" y2="9"/><line x1="20" y1="14" x2="23" y2="14"/>
                  <line x1="1" y1="9" x2="4" y2="9"/><line x1="1" y1="14" x2="4" y2="14"/>
                </svg>
                PID: ${s.mainPid}${s.tasksCount && s.tasksCount > 1 ? ` (${s.tasksCount} tasks)` : ''}
              </span>
            `
                : ''
            }
          </div>

          <div class="card-actions">
            <!-- Stop Button -->
            <button
              class="btn btn-danger btn-action-small btn-stop"
              data-name="${escapeHtml(s.name)}"
              ${!isRunning || isPending ? 'disabled' : ''}
              title="Stop this running service"
            >
              ${
                isPending
                  ? '<div class="spinner"></div>'
                  : '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"></rect></svg>'
              }
              Stop
            </button>

            <!-- Run (Start) Button -->
            <button
              class="btn btn-success btn-action-small btn-run"
              data-name="${escapeHtml(s.name)}"
              ${isRunning || isPending ? 'disabled' : ''}
              title="Start / Run this service"
            >
              ${
                isPending
                  ? '<div class="spinner"></div>'
                  : '<svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>'
              }
              Run
            </button>

            <!-- Restart Button -->
            <button
              class="btn btn-secondary btn-action-small btn-restart"
              data-name="${escapeHtml(s.name)}"
              ${!isRunning || isPending ? 'disabled' : ''}
              title="Restart service"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                <path d="M21.5 2v6h-6M2.5 22v-6h6M2 11.5a10 10 0 0 1 18.8-4.3M22 12.5a10 10 0 0 1-18.8 4.2"/>
              </svg>
              Restart
            </button>
          </div>
        </div>

        ${
          s.description
            ? `<div class="service-desc">${escapeHtml(s.description)}</div>`
            : ''
        }

        <div class="card-meta">
          <!-- RAM Usage Pill -->
          <div class="meta-pill highlight-ram" title="RAM Consumed by Service">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M6 19v2"/><path d="M10 19v2"/><path d="M14 19v2"/><path d="M18 19v2"/>
              <rect x="4" y="4" width="16" height="15" rx="2"/>
            </svg>
            <strong>RAM:</strong>
            <code>${escapeHtml(s.memoryFormatted || (isRunning ? '< 1 MB' : '0 B'))}</code>
          </div>

          <!-- Process / Task Pill -->
          <div class="meta-pill highlight-proc" title="Main PID and Task/Thread Information">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <rect x="4" y="4" width="16" height="16" rx="2"/>
              <rect x="9" y="9" width="6" height="6"/>
            </svg>
            <strong>Process:</strong>
            <code>${s.mainPid ? `PID ${s.mainPid}` : 'None'}${s.tasksCount !== undefined && s.tasksCount > 0 ? ` (${s.tasksCount} task${s.tasksCount === 1 ? '' : 's'})` : ''}</code>
          </div>

          <!-- Unit File Location -->
          <div class="meta-pill" title="Systemd Unit File Location">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path>
              <polyline points="13 2 13 9 20 9"></polyline>
            </svg>
            <strong>Location:</strong>
            <code>${escapeHtml(s.fragmentPath)}</code>
            <button class="copy-btn btn-copy" data-copy="${escapeHtml(s.fragmentPath)}" title="Copy location path">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>

          <!-- Binary Path (if present) -->
          ${
            s.execStart
              ? `
            <div class="meta-pill" title="Executable Binary Path">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"></polygon>
              </svg>
              <strong>Binary:</strong>
              <code>${escapeHtml(s.execStart)}</code>
              <button class="copy-btn btn-copy" data-copy="${escapeHtml(s.execStart)}" title="Copy binary path">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                  <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                </svg>
              </button>
            </div>
          `
              : ''
          }

          <!-- Status details -->
          <div class="meta-pill">
            <span>state: <code>${escapeHtml(s.activeState)} / ${escapeHtml(s.subState)}</code></span>
          </div>
        </div>
      </div>
    `;
  }

  servicesContainer.innerHTML = html;

  // Attach event handlers
  servicesContainer
    .querySelectorAll<HTMLButtonElement>('.btn-stop')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-name');
        const service = servicesList.find((s) => s.name === name);
        if (service) handleServiceAction('stop', service);
      });
    });

  servicesContainer
    .querySelectorAll<HTMLButtonElement>('.btn-run')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-name');
        const service = servicesList.find((s) => s.name === name);
        if (service) handleServiceAction('start', service);
      });
    });

  servicesContainer
    .querySelectorAll<HTMLButtonElement>('.btn-restart')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        const name = btn.getAttribute('data-name');
        const service = servicesList.find((s) => s.name === name);
        if (service) handleServiceAction('restart', service);
      });
    });

  servicesContainer
    .querySelectorAll<HTMLButtonElement>('.btn-copy')
    .forEach((btn) => {
      btn.addEventListener('click', () => {
        const text = btn.getAttribute('data-copy');
        if (text) copyToClipboard(text, btn);
      });
    });
}

/**
 * Fetch services from systemctl and update counters
 */
async function loadServices(showLoading = true): Promise<void> {
  if (showLoading) {
    isLoading = true;
    refreshIcon.classList.add('rotating');
    renderServices();
  }

  try {
    const list = await window.servicesAPI.getServices(
      currentScope,
      currentFilter,
    );
    servicesList = list;

    // Update the counter pill for current filter
    if (currentFilter === 'running') {
      countRunning.textContent = String(list.length);
    } else if (currentFilter === 'stopped') {
      countStopped.textContent = String(list.length);
    } else {
      countAll.textContent = String(list.length);
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    showToast('error', `Failed to load services: ${msg}`);
    servicesContainer.innerHTML = `
      <div class="state-box">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="1.5">
          <circle cx="12" cy="12" r="10"></circle>
          <line x1="12" y1="8" x2="12" y2="12"></line>
          <line x1="12" y1="16" x2="12.01" y2="16"></line>
        </svg>
        <h3>Failed to query services</h3>
        <p>${escapeHtml(msg)}</p>
        <button id="btn-retry" class="btn btn-secondary" style="margin-top:0.5rem;">Retry</button>
      </div>
    `;
    document.getElementById('btn-retry')?.addEventListener('click', () => {
      loadServices(true);
    });
  } finally {
    isLoading = false;
    refreshIcon.classList.remove('rotating');
    renderServices();
  }
}

/**
 * Escape raw strings for safe innerHTML injection
 */
function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

// Event Listeners: Scope Tabs
tabSystem.addEventListener('click', () => {
  if (currentScope === 'system') return;
  currentScope = 'system';
  tabSystem.classList.add('active');
  tabUser.classList.remove('active');
  loadServices(true);
});

tabUser.addEventListener('click', () => {
  if (currentScope === 'user') return;
  currentScope = 'user';
  tabUser.classList.add('active');
  tabSystem.classList.remove('active');
  loadServices(true);
});

// Event Listeners: Filter Buttons
filterBtns.forEach((btn) => {
  btn.addEventListener('click', () => {
    const filter = btn.getAttribute('data-filter') as ServiceStateFilter;
    if (filter === currentFilter) return;

    filterBtns.forEach((b) => b.classList.remove('active'));
    btn.classList.add('active');

    currentFilter = filter;
    loadServices(true);
  });
});

// Event Listeners: Search
searchInput.addEventListener('input', () => {
  searchQuery = searchInput.value;
  if (searchQuery) {
    searchClear.classList.remove('hidden');
  } else {
    searchClear.classList.add('hidden');
  }
  renderServices();
});

searchClear.addEventListener('click', () => {
  searchInput.value = '';
  searchQuery = '';
  searchClear.classList.add('hidden');
  renderServices();
  searchInput.focus();
});

// Event Listeners: Refresh Button
btnRefresh.addEventListener('click', () => {
  loadServices(true);
});

// Event Listeners: Auto Refresh Toggle
autoRefreshCheck.addEventListener('change', () => {
  if (autoRefreshCheck.checked) {
    autoRefreshTimer = setInterval(() => {
      if (pendingActions.size === 0) {
        loadServices(false);
      }
    }, 5000);
    showToast('success', 'Auto-refresh enabled (5s interval)');
  } else {
    if (autoRefreshTimer) {
      clearInterval(autoRefreshTimer);
      autoRefreshTimer = null;
    }
  }
});

// Bootstrap
async function bootstrap(): Promise<void> {
  await initSystemInfo();
  await loadServices(true);
}

bootstrap();
