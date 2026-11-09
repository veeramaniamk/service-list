import { execFile } from 'node:child_process';
import fs from 'node:fs';
import util from 'node:util';
import type {
  ActionResult,
  ServiceItem,
  ServiceScope,
  ServiceStateFilter,
  SystemInfo,
} from './types';

const execFileAsync = util.promisify(execFile);

// Check if pkexec is available on Linux
const hasPolkit = fs.existsSync('/usr/bin/pkexec');

/**
 * Returns system and execution environment info
 */
export function getSystemInfo(): SystemInfo {
  const isElevated =
    typeof process.getuid === 'function' ? process.getuid() === 0 : false;
  const user =
    process.env.USER ||
    process.env.USERNAME ||
    (isElevated ? 'root' : 'unknown');

  return {
    platform: process.platform,
    isElevated,
    user,
    hasPolkit,
  };
}

/**
 * Formats bytes into human-readable string (KB, MB, GB)
 */
export function formatBytes(bytes?: number): string {
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
 * Fallback to read resident set size (VmRSS) from /proc/<pid>/status
 */
function getProcessRssBytes(pid: number): number | undefined {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const match = status.match(/VmRSS:\s+(\d+)\s+kB/i);
    if (match) {
      return parseInt(match[1], 10) * 1024;
    }
  } catch {
    // Process may have exited or permissions restricted
  }
  return undefined;
}

interface RawSystemdUnit {
  unit: string;
  load: string;
  active: string;
  sub: string;
  description: string;
}

interface ParsedServiceDetails {
  fragmentPath?: string;
  execStart?: string;
  mainPid?: number;
  memoryBytes?: number;
  tasksCount?: number;
}

/**
 * Parses key-value output from `systemctl show`
 */
function parseSystemctlShow(output: string): Map<string, ParsedServiceDetails> {
  const map = new Map<string, ParsedServiceDetails>();
  const blocks = output.split('\n\n');

  for (const block of blocks) {
    if (!block.trim()) continue;
    const lines = block.split('\n');
    let id = '';
    let fragmentPath = '';
    let execStart = '';
    let mainPid: number | undefined;
    let memoryBytes: number | undefined;
    let tasksCount: number | undefined;

    for (const line of lines) {
      const idx = line.indexOf('=');
      if (idx === -1) continue;
      const key = line.slice(0, idx).trim();
      const value = line.slice(idx + 1).trim();

      if (key === 'Id') {
        id = value;
      } else if (key === 'FragmentPath') {
        fragmentPath = value;
      } else if (key === 'ExecStart') {
        execStart = value;
      } else if (key === 'MainPID') {
        const parsedPid = parseInt(value, 10);
        if (!isNaN(parsedPid) && parsedPid > 0) {
          mainPid = parsedPid;
        }
      } else if (key === 'MemoryCurrent') {
        const parsedMem = parseInt(value, 10);
        if (!isNaN(parsedMem) && parsedMem > 0) {
          memoryBytes = parsedMem;
        }
      } else if (key === 'TasksCurrent') {
        const parsedTasks = parseInt(value, 10);
        if (!isNaN(parsedTasks) && parsedTasks >= 0) {
          tasksCount = parsedTasks;
        }
      }
    }

    if (id) {
      let binaryPath: string | undefined;
      const match = execStart.match(/path=([^ ;]+)/);
      if (match) {
        binaryPath = match[1];
      }

      // If MemoryCurrent was not available from systemd, attempt /proc RSS lookup
      if (memoryBytes === undefined && mainPid && mainPid > 0) {
        memoryBytes = getProcessRssBytes(mainPid);
      }

      map.set(id, {
        fragmentPath: fragmentPath || undefined,
        execStart: binaryPath,
        mainPid,
        memoryBytes,
        tasksCount,
      });
    }
  }

  return map;
}

/**
 * Fallback parser for text output of `systemctl list-units`
 */
function parseTextListUnits(output: string): RawSystemdUnit[] {
  const lines = output.split('\n');
  const results: RawSystemdUnit[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('LOAD') || trimmed.startsWith('●')) {
      continue;
    }

    const parts = trimmed.split(/\s+/);
    if (parts.length >= 4 && parts[0].includes('.service')) {
      const unit = parts[0].replace(/^●\s*/, '');
      const load = parts[1];
      const active = parts[2];
      const sub = parts[3];
      const description = parts.slice(4).join(' ');
      results.push({ unit, load, active, sub, description });
    }
  }

  return results;
}

/**
 * Retrieves the list of services for given scope and state filter
 */
export async function getServices(
  scope: ServiceScope,
  filter: ServiceStateFilter,
): Promise<ServiceItem[]> {
  if (process.platform !== 'linux') {
    return [];
  }

  const scopeArgs = scope === 'user' ? ['--user'] : [];
  const queryArgs = [...scopeArgs, 'list-units', '--type=service'];

  if (filter === 'running') {
    queryArgs.push('--state=running');
  } else if (filter === 'stopped') {
    queryArgs.push('--state=inactive,failed');
  } else {
    queryArgs.push('--all');
  }

  let units: RawSystemdUnit[] = [];

  // Attempt JSON output first
  try {
    const { stdout } = await execFileAsync(
      'systemctl',
      [...queryArgs, '--output=json'],
      {
        timeout: 15000,
      },
    );
    units = JSON.parse(stdout) as RawSystemdUnit[];
  } catch {
    // Fallback to text parsing if JSON flag is unsupported
    try {
      const { stdout } = await execFileAsync(
        'systemctl',
        [...queryArgs, '--no-pager', '--no-legend', '--full'],
        {
          timeout: 15000,
        },
      );
      units = parseTextListUnits(stdout);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to list system services: ${msg}`);
    }
  }

  // Filter only .service units
  const serviceUnits = units.filter(
    (u) => u.unit && u.unit.endsWith('.service'),
  );
  if (serviceUnits.length === 0) {
    return [];
  }

  // Batch query service details (FragmentPath, ExecStart, MainPID, MemoryCurrent, TasksCurrent)
  const chunkSize = 50;
  const detailsMap = new Map<string, ParsedServiceDetails>();

  for (let i = 0; i < serviceUnits.length; i += chunkSize) {
    const chunk = serviceUnits.slice(i, i + chunkSize).map((u) => u.unit);
    try {
      const { stdout } = await execFileAsync(
        'systemctl',
        [
          ...scopeArgs,
          'show',
          ...chunk,
          '-p',
          'Id,FragmentPath,ExecStart,MainPID,MemoryCurrent,TasksCurrent',
        ],
        { timeout: 15000 },
      );
      const chunkMap = parseSystemctlShow(stdout);
      for (const [key, val] of chunkMap.entries()) {
        detailsMap.set(key, val);
      }
    } catch {
      // Continue even if show fails for a chunk
    }
  }

  const items: ServiceItem[] = serviceUnits.map((u) => {
    const details = detailsMap.get(u.unit);
    const memoryBytes = details?.memoryBytes;
    return {
      name: u.unit,
      description: u.description || '',
      loadState: u.load || 'unknown',
      activeState: u.active || 'unknown',
      subState: u.sub || 'unknown',
      fragmentPath: details?.fragmentPath || 'Generated / Dynamic',
      execStart: details?.execStart,
      scope,
      mainPid: details?.mainPid,
      memoryBytes,
      memoryFormatted:
        memoryBytes !== undefined ? formatBytes(memoryBytes) : undefined,
      tasksCount: details?.tasksCount,
    };
  });

  // Sort: running units first, then alphabetically by name
  return items.sort((a, b) => {
    if (a.subState === 'running' && b.subState !== 'running') return -1;
    if (a.subState !== 'running' && b.subState === 'running') return 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Start, stop, or restart a system or user service
 */
export async function controlService(
  action: 'start' | 'stop' | 'restart',
  name: string,
  scope: ServiceScope,
): Promise<ActionResult> {
  // Validate service name against command injection
  if (!/^[a-zA-Z0-9_.@-]+$/.test(name)) {
    return {
      success: false,
      error: 'Invalid service name format.',
    };
  }

  if (process.platform !== 'linux') {
    return {
      success: false,
      error: 'Service management is currently supported on Linux (systemd).',
    };
  }

  // User scope does not require root privileges
  if (scope === 'user') {
    try {
      await execFileAsync('systemctl', ['--user', action, name], {
        timeout: 20000,
      });
      return {
        success: true,
        message: `Service "${name}" ${action}ed successfully.`,
      };
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'stderr' in err
          ? String((err as { stderr: unknown }).stderr)
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        success: false,
        error: msg.trim() || `Failed to ${action} user service.`,
      };
    }
  }

  // System scope
  const isRoot =
    typeof process.getuid === 'function' ? process.getuid() === 0 : false;

  if (isRoot) {
    try {
      await execFileAsync('systemctl', [action, name], { timeout: 20000 });
      return {
        success: true,
        message: `Service "${name}" ${action}ed successfully.`,
      };
    } catch (err: unknown) {
      const msg =
        err && typeof err === 'object' && 'stderr' in err
          ? String((err as { stderr: unknown }).stderr)
          : err instanceof Error
            ? err.message
            : String(err);
      return {
        success: false,
        error: msg.trim() || `Failed to ${action} service "${name}".`,
      };
    }
  }

  // If not root, elevate with pkexec if available
  if (hasPolkit) {
    try {
      await execFileAsync('pkexec', ['systemctl', action, name], {
        timeout: 60000,
      });
      return {
        success: true,
        message: `Service "${name}" ${action}ed successfully.`,
      };
    } catch (err: unknown) {
      const rawMsg =
        err && typeof err === 'object' && 'stderr' in err
          ? String((err as { stderr: unknown }).stderr)
          : err instanceof Error
            ? err.message
            : String(err);
      const msg = rawMsg.trim();

      if (
        msg.includes('dismissed') ||
        msg.includes('cancelled') ||
        msg.includes('not authorized')
      ) {
        return {
          success: false,
          error: 'Authentication was cancelled or declined.',
        };
      }

      return {
        success: false,
        error:
          msg ||
          'Authentication failed. Elevated privileges are required to manage system services.',
      };
    }
  }

  // Neither root nor pkexec
  return {
    success: false,
    error:
      'Permission denied. Managing system services requires root privileges. Please run the application with "sudo -E npm start" or install Polkit (pkexec).',
  };
}
