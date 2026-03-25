const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfDesktopApi', {
  openPdf: () => ipcRenderer.invoke('pdf:open'),
  savePdf: (payload) => ipcRenderer.invoke('pdf:save', payload),
  listCertificates: () => ipcRenderer.invoke('signer:listCertificates'),
  signWithUsb: (payload) => ipcRenderer.invoke('pdf:signWithUsb', payload)
});
