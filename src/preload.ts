import { contextBridge, ipcRenderer } from 'electron';
import type {
  ActionResult,
  ServiceItem,
  ServiceScope,
  ServiceStateFilter,
  SystemInfo,
} from './types';

contextBridge.exposeInMainWorld('servicesAPI', {
  getServices: (
    scope: ServiceScope,
    filter: ServiceStateFilter,
  ): Promise<ServiceItem[]> =>
    ipcRenderer.invoke('services:get-list', { scope, filter }),

  startService: (name: string, scope: ServiceScope): Promise<ActionResult> =>
    ipcRenderer.invoke('services:control', { action: 'start', name, scope }),

  stopService: (name: string, scope: ServiceScope): Promise<ActionResult> =>
    ipcRenderer.invoke('services:control', { action: 'stop', name, scope }),

  restartService: (name: string, scope: ServiceScope): Promise<ActionResult> =>
    ipcRenderer.invoke('services:control', { action: 'restart', name, scope }),

  getSystemInfo: (): Promise<SystemInfo> =>
    ipcRenderer.invoke('services:get-system-info'),
});
