import { contextBridge, ipcRenderer } from 'electron';

// Ponte mínima para as páginas: nada de Node, só estas chamadas, todas validadas no processo principal.
contextBridge.exposeInMainWorld('riverfront', {
  platform: 'desktop',
  host: {
    start: (port: number) => ipcRenderer.invoke('host:start', port),
    stop: () => ipcRenderer.invoke('host:stop'),
    status: () => ipcRenderer.invoke('host:status'),
  },
  openClient: (target: { server?: string; room?: string }) => ipcRenderer.invoke('app:open-client', target),
  openLauncher: () => ipcRenderer.invoke('app:open-launcher'),
  copy: (text: string) => ipcRenderer.invoke('clipboard:write', text),
});
