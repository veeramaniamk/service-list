export type ServiceScope = 'system' | 'user';
export type ServiceStateFilter = 'all' | 'running' | 'stopped';

export interface ServiceItem {
  name: string;
  description: string;
  loadState: string;
  activeState: string;
  subState: string;
  fragmentPath: string;
  execStart?: string;
  scope: ServiceScope;
  mainPid?: number;
  memoryBytes?: number;
  memoryFormatted?: string;
  tasksCount?: number;
}

export interface ActionResult {
  success: boolean;
  message?: string;
  error?: string;
}

export interface SystemInfo {
  platform: string;
  isElevated: boolean;
  user: string;
  hasPolkit: boolean;
}

export interface ServicesAPI {
  getServices: (
    scope: ServiceScope,
    filter: ServiceStateFilter,
  ) => Promise<ServiceItem[]>;
  startService: (name: string, scope: ServiceScope) => Promise<ActionResult>;
  stopService: (name: string, scope: ServiceScope) => Promise<ActionResult>;
  restartService: (name: string, scope: ServiceScope) => Promise<ActionResult>;
  getSystemInfo: () => Promise<SystemInfo>;
}
