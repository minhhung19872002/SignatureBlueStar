const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('pdfDesktopApi', {
  openPdf: () => ipcRenderer.invoke('pdf:open'),
  openMultiplePdfs: () => ipcRenderer.invoke('pdf:openMultiple'),
  savePdf: (payload) => ipcRenderer.invoke('pdf:save', payload),
  listCertificates: () => ipcRenderer.invoke('signer:listCertificates'),
  signWithUsb: (payload) => ipcRenderer.invoke('pdf:signWithUsb', payload),
  signBatchWithUsb: (payload) => ipcRenderer.invoke('pdf:signBatchWithUsb', payload)
});
