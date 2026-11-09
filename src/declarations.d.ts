/// <reference types="@electron-forge/plugin-vite/forge-vite-env" />

declare module '*.css';

declare interface Window {
  servicesAPI: import('./types').ServicesAPI;
}
