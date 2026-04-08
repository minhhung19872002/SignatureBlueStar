const state = {
  files: [],           // Map<id, FileState>
  currentFileId: null,  // id of the active file in the viewer
  certificates: [],     // WINCA certificates loaded from bridge
  contractorCerts: [],  // shared cert list for contractor panel
  batchActive: false,
  batchCancelled: false
};

// ── DOM element references ──
const openFileBtn = document.getElementById('open-file-btn');
const applySignatureBtn = document.getElementById('apply-signature-btn');
const saveFileBtn = document.getElementById('save-file-btn');
const usbSignBtn = document.getElementById('usb-sign-btn');
const certificateSelect = document.getElementById('certificate-select');
const pdfContainer = document.getElementById('pdf-container');
const emptyState = document.getElementById('empty-state');
const fileNameText = document.getElementById('file-name');
const statusText = document.getElementById('status-text');
const signatureTextInput = document.getElementById('signature-text');
const signatureSubtitleInput = document.getElementById('signature-subtitle');
const fontSizeInput = document.getElementById('font-size');
const fontSizeLabel = document.getElementById('font-size-label');

// File queue elements
const fileQueuePanel = document.getElementById('file-queue-panel');
const fileQueueList = document.getElementById('file-queue-list');
const fileQueueEmpty = document.getElementById('file-queue-empty');
const batchActions = document.getElementById('batch-actions');
const batchUsbSignBtn = document.getElementById('batch-usb-sign-btn');
const batchContractorSignBtn = document.getElementById('batch-contractor-sign-btn');
const clearAllBtn = document.getElementById('clear-all-btn');
const reuseHint = document.getElementById('reuse-hint');

// Batch overlay elements
const batchOverlay = document.getElementById('batch-overlay');
const batchOverlayIcon = document.getElementById('batch-overlay-icon');
const batchOverlayTitle = document.getElementById('batch-overlay-title');
const batchOverlaySubtitle = document.getElementById('batch-overlay-subtitle');
const batchProgressBar = document.getElementById('batch-progress-bar');
const batchProgressText = document.getElementById('batch-progress-text');
const batchFileText = document.getElementById('batch-file-text');
const batchCancelBtn = document.getElementById('batch-cancel-btn');
const batchSummary = document.getElementById('batch-summary');
const batchCancelBtnArea = batchCancelBtn;

// Contractor panel elements
const contractorCertSelect = document.getElementById('contractor-cert-select');
const contractorSignBtn = document.getElementById('contractor-sign-btn');
const contractorCompanyInput = document.getElementById('contractor-company');
const contractorMstInput = document.getElementById('contractor-mst');
const contractorAddressInput = document.getElementById('contractor-address');
const contractorNameInput = document.getElementById('contractor-name');
const contractorTitleInput = document.getElementById('contractor-title-input');
const sealTemplateSelect = document.getElementById('seal-template-select');
const cpSig = document.getElementById('cp-sig');
const cpName = document.getElementById('cp-name');
const cpRole = document.getElementById('cp-role');

// ── Event listeners ──
openFileBtn.addEventListener('click', handleOpenPdf);
applySignatureBtn.addEventListener('click', handleApplySignature);
saveFileBtn.addEventListener('click', handleSavePdf);
usbSignBtn.addEventListener('click', handleUsbSign);
fontSizeInput.addEventListener('input', () => {
  fontSizeLabel.textContent = `${fontSizeInput.value} px`;
});
certificateSelect.addEventListener('change', updateButtonStates);
contractorCertSelect.addEventListener('change', updateButtonStates);
contractorNameInput.addEventListener('input', updateContractorPreview);
contractorTitleInput.addEventListener('input', updateContractorPreview);
contractorSignBtn.addEventListener('click', handleContractorSign);
batchUsbSignBtn.addEventListener('click', handleBatchUsbSign);
batchContractorSignBtn.addEventListener('click', handleBatchContractorSign);
clearAllBtn.addEventListener('click', handleClearAll);
batchCancelBtn.addEventListener('click', () => {
  if (state.batchActive) {
    state.batchCancelled = true;
    return;
  }

  closeBatchOverlay();
});

setStatus('San sang. Hay mo mot file PDF de bat dau.');
loadCertificates();
loadContractorCertificates();

// ═══════════════════════════════════════════════════════
//  FILE STATE HELPERS
// ═══════════════════════════════════════════════════════

function nextId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

function getCurrentFile() {
  return state.files.find((f) => f.id === state.currentFileId) || null;
}

function getCurrentState() {
  const f = getCurrentFile();
  return f || null;
}

// ═══════════════════════════════════════════════════════
//  FILE QUEUE UI
// ═══════════════════════════════════════════════════════

function renderFileQueue() {
  if (state.files.length === 0) {
    fileQueuePanel.classList.add('hidden');
    batchActions.classList.add('hidden');
    reuseHint.classList.add('hidden');
    return;
  }

  fileQueuePanel.classList.remove('hidden');
  fileQueueList.innerHTML = '';

  state.files.forEach((file) => {
    const li = document.createElement('li');
    li.className = 'file-item';
    li.dataset.id = file.id;

    if (file.id === state.currentFileId) li.classList.add('is-active');
    if (file.status === 'signed') li.classList.add('is-signed');
    if (file.status === 'error') li.classList.add('is-error');

    const icon = getFileIcon(file.status);
    const badge = getFileBadge(file);

    li.innerHTML = `
      <span class="file-item__icon">${icon}</span>
      <div class="file-item__info">
        <div class="file-item__name" title="${escapeHtml(file.fileName)}">${escapeHtml(file.fileName)}</div>
        <div class="file-item__meta">${getStatusLabel(file.status)}</div>
      </div>
      ${badge}
      <button class="file-item__remove" title="Xoa khoi hang doi" data-id="${file.id}">✕</button>
    `;

    // Click to switch to this file
    li.addEventListener('click', (e) => {
      if (e.target.classList.contains('file-item__remove')) return;
      switchToFile(file.id);
    });

    // Remove button
    li.querySelector('.file-item__remove').addEventListener('click', (e) => {
      e.stopPropagation();
      removeFileFromQueue(file.id);
    });

    fileQueueList.appendChild(li);
  });

  // Show batch actions when 2+ files
  if (state.files.length >= 2) {
    batchActions.classList.remove('hidden');
    reuseHint.classList.remove('hidden');
  } else {
    batchActions.classList.add('hidden');
    reuseHint.classList.add('hidden');
  }
}

function getFileIcon(status) {
  if (status === 'signed') return '✅';
  if (status === 'error') return '❌';
  if (status === 'signing') return '⚙️';
  return '📄';
}

function getFileBadge(file) {
  if (file.id === state.currentFileId) {
    return '<span class="file-item__badge file-item__badge--active">Hien thi</span>';
  }
  if (file.status === 'signed') {
    return '<span class="file-item__badge file-item__badge--signed">Da ky</span>';
  }
  if (file.status === 'error') {
    return '<span class="file-item__badge file-item__badge--error">Loi</span>';
  }
  return '';
}

function getStatusLabel(status) {
  const labels = {
    pending: 'Chua ky',
    signing: 'Dang ky so...',
    signed: 'Da ky so',
    error: 'Ky that bai'
  };
  return labels[status] || status;
}

// ═══════════════════════════════════════════════════════
//  FILE MANAGEMENT
// ═══════════════════════════════════════════════════════

function addFileToQueue(fileData) {
  const id = nextId();
  const fileState = {
    id,
    filePath: fileData.filePath,
    fileName: fileData.fileName,
    status: 'pending',       // 'pending' | 'signing' | 'signed' | 'error'
    pdfBytes: null,
    pdfDoc: null,
    pdfJsDoc: null,
    pages: [],
    selection: null,
    placements: [],
    signedBytes: null,
    errorMessage: null
  };
  state.files.push(fileState);
  return fileState;
}

function removeFileFromQueue(id) {
  const idx = state.files.findIndex((f) => f.id === id);
  if (idx === -1) return;

  // If removing the currently viewed file, switch to another or show empty
  if (id === state.currentFileId) {
    state.files.splice(idx, 1);
    const next = state.files.find((f) => f.status !== 'signed');
    if (next) {
      switchToFile(next.id);
    } else if (state.files.length > 0) {
      switchToFile(state.files[0].id);
    } else {
      state.currentFileId = null;
      showEmptyState();
    }
  } else {
    state.files.splice(idx, 1);
  }
  renderFileQueue();
  updateButtonStates();
}

function handleClearAll() {
  state.files = [];
  state.currentFileId = null;
  showEmptyState();
  renderFileQueue();
  updateButtonStates();
  setStatus('Da xoa tat ca file PDF.');
}

async function switchToFile(id) {
  const file = state.files.find((f) => f.id === id);
  if (!file) return;

  state.currentFileId = id;
  fileNameText.textContent = file.fileName;

  if (file.pdfDoc) {
    await showPdfInViewer(file);
  } else if (file.filePath) {
    // Load from base64 data
    await loadPdfForFile(file);
  }

  renderFileQueue();
  updateButtonStates();
  setStatus(`Hien thi: ${file.fileName}`);
}

// ═══════════════════════════════════════════════════════
//  PDF LOADING
// ═══════════════════════════════════════════════════════

async function ensurePdfLibraries() {
  if (!window.PDFLib) {
    throw new Error('pdf-lib did not load in the renderer.');
  }

  if (!state.pdfjsLib) {
    state.pdfjsLib = await import('./node_modules/pdfjs-dist/build/pdf.mjs');
    state.pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      './node_modules/pdfjs-dist/build/pdf.worker.mjs',
      import.meta.url
    ).toString();
  }

  return {
    pdfjsLib: state.pdfjsLib,
    PDFLib: window.PDFLib
  };
}

async function loadPdfForFile(file) {
  if (!file._rawBase64) return;
  const rawBytes = base64ToUint8Array(file._rawBase64);
  await loadPdfBytesIntoFile(file, rawBytes);
}

async function loadPdfBytesIntoFile(file, rawBytes) {
  const { pdfjsLib, PDFLib } = await ensurePdfLibraries();
  const { PDFDocument } = PDFLib;

  file.pdfBytes = rawBytes;
  // Preserve original bytes for batch signing — never clear _rawBase64
  if (!file._rawBase64) {
    file._rawBase64 = uint8ArrayToBase64(rawBytes);
  }
  file.selection = null;
  file.placements = [];

  file.pdfDoc = await PDFDocument.load(rawBytes);
  file.pdfJsDoc = await pdfjsLib.getDocument({ data: rawBytes }).promise;
  file.pages = await renderAllPages(file.pdfJsDoc, file);
}

async function showPdfInViewer(file) {
  emptyState.classList.add('hidden');
  pdfContainer.classList.remove('hidden');
  pdfContainer.innerHTML = '';

  file.pages = await renderAllPages(file.pdfJsDoc, file);
  file.placements.forEach((p) => addSignaturePreviewForFile(p, file));
  restoreSelectionVisual(file);

  applySignatureBtn.disabled = !file.selection;
  saveFileBtn.disabled = file.placements.length === 0;
  updateButtonStates();
}

function showEmptyState() {
  emptyState.classList.remove('hidden');
  pdfContainer.classList.add('hidden');
  pdfContainer.innerHTML = '';
  fileNameText.textContent = 'Chưa có file nào được mở.';
  applySignatureBtn.disabled = true;
  saveFileBtn.disabled = true;
  updateButtonStates();
}

// ═══════════════════════════════════════════════════════
//  OPEN PDF / MULTIPLE PDFs
// ═══════════════════════════════════════════════════════

async function handleOpenPdf() {
  if (!window.pdfDesktopApi?.openMultiplePdfs) {
    setStatus('Khong tim thay Electron bridge. Hay tat app va mo lai.');
    return;
  }

  setStatus('Dang mo hop chon file PDF...');

  let results = [];
  try {
    results = await window.pdfDesktopApi.openMultiplePdfs();
  } catch (error) {
    console.error(error);
    setStatus(`Mo hop chon file that bai: ${error.message}`);
    return;
  }

  if (!results || results.length === 0) {
    setStatus('Ban da huy thao tac mo file.');
    return;
  }

  // Add all files to queue (store raw base64 in a temp field)
  results.forEach((r) => {
    const file = addFileToQueue(r);
    file._rawBase64 = r.data;
  });

  // Load and show the first file
  const firstFile = state.files[state.files.length - results.length];
  state.currentFileId = firstFile.id;
  fileNameText.textContent = firstFile.fileName;

  try {
    await loadPdfBytesIntoFile(firstFile, base64ToUint8Array(firstFile._rawBase64));
    await showPdfInViewer(firstFile);
  } catch (error) {
    console.error(error);
    setStatus(`Khong the doc file PDF: ${error.message}`);
  }

  // Load the rest in background (don't block UI)
  // Keep _rawBase64 until user switches away from the current file
  const restFiles = state.files.slice(1);
  for (const file of restFiles) {
    try {
      await loadPdfBytesIntoFile(file, base64ToUint8Array(file._rawBase64));
      // Only clear base64 for files we've successfully loaded AND
      // that are NOT the file being currently viewed
      if (file.id !== state.currentFileId) {
        file._rawBase64 = null;
      }
    } catch (e) {
      console.warn(`Failed to pre-load ${file.fileName}:`, e);
      file.status = 'error';
      file.errorMessage = e.message;
      renderFileQueue();
      updateButtonStates();
    }
  }

  const count = state.files.length;
  renderFileQueue();
  updateButtonStates();

  if (count === 1) {
    setStatus('PDF da duoc tai. Keo chuot tren trang de chon vung ky.');
  } else {
    setStatus(`Da tai ${count} file PDF. Chon vung ky tren file hien tai, sau do ky so nhieu file.`);
  }
}

// ═══════════════════════════════════════════════════════
//  RENDER PDF PAGES
// ═══════════════════════════════════════════════════════

async function renderAllPages(pdfJsDoc, file) {
  const pages = [];
  for (let pageIndex = 1; pageIndex <= pdfJsDoc.numPages; pageIndex += 1) {
    const page = await pdfJsDoc.getPage(pageIndex);
    const viewport = page.getViewport({ scale: 1.45 });

    const wrapper = document.createElement('div');
    wrapper.className = 'pdf-page';
    wrapper.dataset.pageIndex = String(pageIndex - 1);
    wrapper.style.width = `${viewport.width}px`;
    wrapper.style.height = `${viewport.height}px`;

    const canvas = document.createElement('canvas');
    canvas.className = 'pdf-canvas';
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${viewport.width}px`;
    canvas.style.height = `${viewport.height}px`;

    wrapper.appendChild(canvas);
    pdfContainer.appendChild(wrapper);

    const context = canvas.getContext('2d');
    await page.render({ canvasContext: context, viewport }).promise;

    bindSelectionEvents(wrapper, viewport, pageIndex - 1, file);
    pages.push({ pageIndex: pageIndex - 1, viewport, wrapper, canvas });
  }

  return pages;
}

// ═══════════════════════════════════════════════════════
//  SELECTION EVENTS
// ═══════════════════════════════════════════════════════

function bindSelectionEvents(wrapper, viewport, pageIndex, file) {
  let startX = 0;
  let startY = 0;
  let selectionBox = null;
  let isDragging = false;

  wrapper.onpointerdown = (event) => {
    clearSelectionVisuals();
    file.selection = null;
    applySignatureBtn.disabled = true;
    saveFileBtn.disabled = file.placements.length === 0;
    updateButtonStates();

    const bounds = wrapper.getBoundingClientRect();
    startX = event.clientX - bounds.left;
    startY = event.clientY - bounds.top;
    isDragging = true;

    selectionBox = document.createElement('div');
    selectionBox.className = 'selection-box';
    selectionBox.style.left = `${startX}px`;
    selectionBox.style.top = `${startY}px`;
    selectionBox.style.width = '0px';
    selectionBox.style.height = '0px';
    wrapper.appendChild(selectionBox);
    wrapper.setPointerCapture(event.pointerId);
  };

  wrapper.onpointermove = (event) => {
    if (!isDragging || !selectionBox) return;

    const bounds = wrapper.getBoundingClientRect();
    const currentX = event.clientX - bounds.left;
    const currentY = event.clientY - bounds.top;
    const left = Math.max(0, Math.min(startX, currentX));
    const top = Math.max(0, Math.min(startY, currentY));
    const width = Math.min(bounds.width, Math.abs(currentX - startX));
    const height = Math.min(bounds.height, Math.abs(currentY - startY));

    selectionBox.style.left = `${left}px`;
    selectionBox.style.top = `${top}px`;
    selectionBox.style.width = `${width}px`;
    selectionBox.style.height = `${height}px`;
  };

  wrapper.onpointerup = (event) => {
    if (!isDragging || !selectionBox) return;

    isDragging = false;
    wrapper.releasePointerCapture(event.pointerId);

    const left = parseFloat(selectionBox.style.left);
    const top = parseFloat(selectionBox.style.top);
    const width = parseFloat(selectionBox.style.width);
    const height = parseFloat(selectionBox.style.height);

    if (width < 16 || height < 16) {
      selectionBox.remove();
      file.selection = null;
      applySignatureBtn.disabled = true;
      updateButtonStates();
      setStatus('Vung chon qua nho. Hay keo lai de chon vung rong hon.');
      return;
    }

    file.selection = {
      pageIndex,
      viewport,
      screenRect: { left, top, width, height }
    };
    applySignatureBtn.disabled = false;
    saveFileBtn.disabled = file.placements.length === 0;
    updateButtonStates();
    setStatus(`Da chon vung tren trang ${pageIndex + 1}. Co the chen chu ky hoac ky so USB.`);
  };
}

// ═══════════════════════════════════════════════════════
//  VISUAL SIGNATURE (text + rectangle)
// ═══════════════════════════════════════════════════════

function addSignaturePreviewForFile(placement, file) {
  const page = file.pages.find((item) => item.pageIndex === placement.pageIndex);
  if (!page) return;

  const preview = document.createElement('div');
  preview.className = 'signature-preview';
  preview.style.left = `${placement.screenRect.left}px`;
  preview.style.top = `${placement.screenRect.top}px`;
  preview.style.width = `${placement.screenRect.width}px`;
  preview.style.height = `${placement.screenRect.height}px`;

  const main = document.createElement('div');
  main.className = 'signature-main';
  main.textContent = placement.signatureText;
  main.style.fontSize = `${Math.max(placement.fontSize, 16)}px`;

  const sub = document.createElement('div');
  sub.className = 'signature-sub';
  sub.textContent = placement.subtitle;

  preview.appendChild(main);
  if (placement.subtitle) preview.appendChild(sub);
  page.wrapper.appendChild(preview);
}

async function handleApplySignature() {
  const file = getCurrentFile();
  if (!file || !file.selection || !file.pdfDoc || !window.PDFLib) return;

  const signatureText = signatureTextInput.value.trim();
  if (!signatureText) {
    setStatus('Can nhap noi dung chu ky truoc khi chen vao PDF.');
    signatureTextInput.focus();
    return;
  }

  const { StandardFonts, rgb } = window.PDFLib;
  const subtitle = signatureSubtitleInput.value.trim();
  const fontSize = Number(fontSizeInput.value);
  const { pageIndex, viewport, screenRect } = file.selection;
  const page = file.pdfDoc.getPages()[pageIndex];
  const pdfWidth = page.getWidth();
  const pdfHeight = page.getHeight();

  const scaleX = pdfWidth / viewport.width;
  const scaleY = pdfHeight / viewport.height;
  const pdfX = screenRect.left * scaleX;
  const pdfWidthRect = screenRect.width * scaleX;
  const pdfHeightRect = screenRect.height * scaleY;
  const pdfY = pdfHeight - ((screenRect.top + screenRect.height) * scaleY);

  const cursiveFont = await file.pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const normalFont = await file.pdfDoc.embedFont(StandardFonts.Helvetica);
  const bodyFontSize = Math.max(10, fontSize * scaleY);
  const subtitleFontSize = Math.max(8, bodyFontSize * 0.38);
  const subtitleYOffset = subtitle ? subtitleFontSize + 6 : 0;

  page.drawRectangle({
    x: pdfX, y: pdfY,
    width: pdfWidthRect, height: pdfHeightRect,
    color: rgb(1, 0.982, 0.886),
    opacity: 0.68,
    borderColor: rgb(0.051, 0.424, 0.365),
    borderOpacity: 0.12,
    borderWidth: 1
  });

  page.drawText(signatureText, {
    x: pdfX + 8 * scaleX,
    y: pdfY + Math.max(pdfHeightRect * 0.42, bodyFontSize + subtitleYOffset),
    size: bodyFontSize,
    font: cursiveFont,
    color: rgb(0.043, 0.302, 0.271),
    maxWidth: Math.max(20, pdfWidthRect - 16 * scaleX)
  });

  if (subtitle) {
    page.drawText(subtitle, {
      x: pdfX + 8 * scaleX,
      y: pdfY + 8 * scaleY,
      size: subtitleFontSize,
      font: normalFont,
      color: rgb(0.314, 0.392, 0.373),
      maxWidth: Math.max(20, pdfWidthRect - 16 * scaleX)
    });
  }

  const placement = {
    pageIndex,
    signatureText,
    subtitle,
    fontSize,
    screenRect: { ...screenRect }
  };

  file.placements.push(placement);
  clearSelectionVisuals();
  clearSignaturePreviews();
  file.placements.forEach((p) => addSignaturePreviewForFile(p, file));
  file.selection = null;
  applySignatureBtn.disabled = true;
  saveFileBtn.disabled = false;
  updateButtonStates();
  setStatus(`Da chen chu ky vao trang ${pageIndex + 1}. Co the luu file PDF.`);
}

// ═══════════════════════════════════════════════════════
//  CERTIFICATES
// ═══════════════════════════════════════════════════════

async function loadCertificates() {
  if (!window.pdfDesktopApi?.listCertificates) {
    certificateSelect.innerHTML = '<option value="">Khong co bridge ky so</option>';
    contractorCertSelect.innerHTML = '<option value="">Khong co bridge ky so</option>';
    return;
  }

  try {
    const certificates = await window.pdfDesktopApi.listCertificates();
    state.certificates = certificates;
    state.contractorCerts = certificates;

    if (certificates.length === 0) {
      certificateSelect.innerHTML = '<option value="">Khong tim thay chung thu WINCA</option>';
      contractorCertSelect.innerHTML = '<option value="">Khong tim thay chung thu WINCA</option>';
      usbSignBtn.disabled = true;
      contractorSignBtn.disabled = true;
      batchUsbSignBtn.disabled = true;
      batchContractorSignBtn.disabled = true;
      return;
    }

    const html = certificates
      .map((cert, index) => {
        const label = `${index + 1}. ${trimSubject(cert.subject)} | ${formatDate(cert.notAfter)}`;
        return `<option value="${escapeHtml(cert.thumbprint)}">${escapeHtml(label)}</option>`;
      })
      .join('');

    certificateSelect.innerHTML = html;
    contractorCertSelect.innerHTML = html;
    updateButtonStates();
  } catch (error) {
    console.error(error);
    certificateSelect.innerHTML = '<option value="">Tai chung thu that bai</option>';
    contractorCertSelect.innerHTML = '<option value="">Tai chung thu that bai</option>';
    setStatus(`Khong tai duoc danh sach chung thu: ${error.message}`);
  }
}

function loadContractorCertificates() {
  // Contractor shares the same cert list, loaded in loadCertificates
}

function updateButtonStates() {
  const file = getCurrentFile();
  const hasSelection = file && file.selection;
  const hasCert = certificateSelect.value;
  const hasContractorCert = contractorCertSelect.value;
  const hasPlacements = file && file.placements.length > 0;
  const hasPendingFiles = state.files.filter((f) => f.status === 'pending').length >= 1;

  usbSignBtn.disabled = !hasSelection || !hasCert;
  contractorSignBtn.disabled = !hasSelection || !hasContractorCert;
  saveFileBtn.disabled = !hasPlacements;

  // Batch: 2+ pending files, same cert as current file selection
  batchUsbSignBtn.disabled = state.files.length < 2 || !hasCert;
  batchContractorSignBtn.disabled = state.files.length < 2 || !hasContractorCert;
}

function updateContractorPreview() {
  const name = contractorNameInput.value.trim() || 'Chu ki dien tu';
  const role = contractorTitleInput.value.trim() || 'Chuc vu';
  cpSig.textContent = name;
  cpName.textContent = contractorNameInput.value.trim() ? name : 'Ho Va Ten';
  cpRole.textContent = role;
}

// ═══════════════════════════════════════════════════════
//  USB SIGNING (single file)
// ═══════════════════════════════════════════════════════

async function handleUsbSign() {
  const file = getCurrentFile();
  if (!file || !file.selection) {
    setStatus('Can chon vung ky tren PDF truoc.');
    return;
  }

  if (!certificateSelect.value) {
    setStatus('Can chon chung thu WINCA truoc khi ky so.');
    return;
  }

  try {
    setStatus('Dang chuan bi du lieu ky so...');
    const currentBytes = await file.pdfDoc.save();
    const { pageIndex, viewport, screenRect } = file.selection;
    const page = file.pdfDoc.getPages()[pageIndex];
    const pdfWidth = page.getWidth();
    const pdfHeight = page.getHeight();
    const scaleX = pdfWidth / viewport.width;
    const scaleY = pdfHeight / viewport.height;
    const x1 = screenRect.left * scaleX;
    const y1 = pdfHeight - ((screenRect.top + screenRect.height) * scaleY);
    const x2 = x1 + screenRect.width * scaleX;
    const y2 = y1 + screenRect.height * scaleY;
    const selectedCert = state.certificates?.find((c) => c.thumbprint === certificateSelect.value);

    setStatus('WINCA co the se hien hop nhap PIN. Dang ky so PDF...');
    const signed = await window.pdfDesktopApi.signWithUsb({
      data: uint8ArrayToBase64(currentBytes),
      certThumbprint: certificateSelect.value,
      pageIndex,
      widgetRect: [x1, y1, x2, y2],
      signerName: selectedCert ? trimSubject(selectedCert.subject) : 'WINCA Signer',
      reason: 'Ky so USB token',
      location: 'Vietnam'
    });

    const signedBytes = base64ToUint8Array(signed.data);
    await loadPdfBytesIntoFile(file, signedBytes);

    const suggestedName = file.fileName
      ? file.fileName.replace(/\.pdf$/i, '') + '-signed.pdf'
      : 'signed.pdf';

    const saveResult = await window.pdfDesktopApi.savePdf({
      originalPath: file.filePath,
      suggestedName,
      data: signed.data
    });

    if (saveResult?.filePath) {
      file.status = 'signed';
      file.signedBytes = signedBytes;
      saveFileBtn.disabled = false;
      setStatus(`Da ky so WINCA va luu file tai: ${saveResult.filePath}`);
    } else {
      file.status = 'signed';
      file.signedBytes = signedBytes;
      setStatus('Da ky so thanh cong, nhung ban huy thao tac luu file.');
    }

    renderFileQueue();
    updateButtonStates();
  } catch (error) {
    console.error(error);
    setStatus(`Ky so USB that bai: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════
//  CONTRACTOR SIGNING (single file)
// ═══════════════════════════════════════════════════════

async function handleContractorSign() {
  const file = getCurrentFile();
  if (!file || !file.selection) {
    setStatus('Can chon vung ky tren PDF truoc (Panel Nha Thau).');
    return;
  }

  if (!contractorCertSelect.value) {
    setStatus('Can chon chung thu WINCA (Panel Nha Thau) truoc khi ky so.');
    return;
  }

  const company = contractorCompanyInput.value.trim();
  const mst = contractorMstInput.value.trim();
  const address = contractorAddressInput.value.trim();
  const signerName = contractorNameInput.value.trim() || trimSubject(
    state.contractorCerts?.find((c) => c.thumbprint === contractorCertSelect.value)?.subject || ''
  );
  const signerTitle = contractorTitleInput.value.trim() || 'Giam doc';

  try {
    setStatus('Dang chuan bi du lieu ky so Nha Thau...');
    const currentBytes = await file.pdfDoc.save();
    const { pageIndex, viewport, screenRect } = file.selection;
    const page = file.pdfDoc.getPages()[pageIndex];
    const pdfWidth = page.getWidth();
    const pdfHeight = page.getHeight();
    const scaleX = pdfWidth / viewport.width;
    const scaleY = pdfHeight / viewport.height;
    const x1 = screenRect.left * scaleX;
    const y1 = pdfHeight - ((screenRect.top + screenRect.height) * scaleY);
    const x2 = x1 + screenRect.width * scaleX;
    const y2 = y1 + screenRect.height * scaleY;

    setStatus('WINCA se hien hop nhap PIN. Dang ky so Dai Dien Nha Thau...');
    const signed = await window.pdfDesktopApi.signWithUsb({
      data: uint8ArrayToBase64(currentBytes),
      certThumbprint: contractorCertSelect.value,
      pageIndex,
      widgetRect: [x1, y1, x2, y2],
      signerName: signerName || 'Dai Dien Nha Thau',
      reason: 'Ky so Dai Dien Nha Thau',
      location: address || 'Vietnam',
      companyName: company,
      mst: mst,
      address: address,
      signerTitle: signerTitle,
      signatureImageName: 'Signature_2.png'
    });

    const signedBytes = base64ToUint8Array(signed.data);
    await loadPdfBytesIntoFile(file, signedBytes);

    const suggestedName = file.fileName
      ? file.fileName.replace(/\.pdf$/i, '') + '-nha-thau-signed.pdf'
      : 'signed-nha-thau.pdf';

    const saveResult = await window.pdfDesktopApi.savePdf({
      originalPath: file.filePath,
      suggestedName,
      data: signed.data
    });

    if (saveResult?.filePath) {
      file.status = 'signed';
      file.signedBytes = signedBytes;
      setStatus(`Da ky so Dai Dien Nha Thau va luu tai: ${saveResult.filePath}`);
    } else {
      file.status = 'signed';
      file.signedBytes = signedBytes;
      setStatus('Da ky so thanh cong, nhung ban huy thao tac luu file.');
    }

    renderFileQueue();
    updateButtonStates();
  } catch (error) {
    console.error(error);
    setStatus(`Ky so Nha Thau that bai: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════
//  BATCH SIGNING — CORE
// ═══════════════════════════════════════════════════════

async function signOneFileBatch(file, certThumbprint, options) {
  // Use THIS file's own selection — not the current/viewed file's selection
  if (!file.selection) {
    throw new Error(`Khong co vung chon tren file ${file.fileName}.`);
  }

  const { pageIndex, viewport, screenRect } = file.selection;
  const page = file.pdfDoc.getPages()[pageIndex];
  const pdfWidth = page.getWidth();
  const pdfHeight = page.getHeight();
  const scaleX = pdfWidth / viewport.width;
  const scaleY = pdfHeight / viewport.height;
  const x1 = screenRect.left * scaleX;
  const y1 = pdfHeight - ((screenRect.top + screenRect.height) * scaleY);
  const x2 = x1 + screenRect.width * scaleX;
  const y2 = y1 + screenRect.height * scaleY;

  const currentBytes = await file.pdfDoc.save();

  const signed = await window.pdfDesktopApi.signWithUsb({
    data: uint8ArrayToBase64(currentBytes),
    certThumbprint,
    pageIndex,
    widgetRect: [x1, y1, x2, y2],
    signerName: options.signerName || 'WINCA Signer',
    reason: options.reason || 'Ky so USB token',
    location: options.location || 'Vietnam',
    ...(options.extra || {})
  });

  return base64ToUint8Array(signed.data);
}

async function saveSignedFile(file, signedBytes, suffix = '-signed') {
  const suggestedName = file.fileName
    ? file.fileName.replace(/\.pdf$/i, '') + suffix + '.pdf'
    : 'signed.pdf';

  const saveResult = await window.pdfDesktopApi.savePdf({
    originalPath: file.filePath,
    suggestedName,
    data: uint8ArrayToBase64(signedBytes)
  });

  return saveResult;
}

// ── Batch USB Sign ──
async function handleBatchUsbSign() {
  if (!certificateSelect.value) {
    setStatus('Can chon chung thu WINCA truoc khi ky so nhieu file.');
    return;
  }

  const pendingFiles = state.files.filter((f) => f.status === 'pending');
  if (pendingFiles.length === 0) {
    setStatus('Khong co file nao cho ky so nhieu file.');
    return;
  }

  // Check every file has a selection
  const missingSelection = pendingFiles.filter((f) => !f.selection);
  if (missingSelection.length > 0) {
    setStatus(`Cac file sau chua co vung ky: ${missingSelection.map((f) => f.fileName).join(', ')}`);
    return;
  }

  const thumbprint = certificateSelect.value;
  const cert = state.certificates?.find((c) => c.thumbprint === thumbprint);
  const signerName = cert ? trimSubject(cert.subject) : 'WINCA Signer';

  const totalCount = pendingFiles.length;
  state.batchCancelled = false;

  showBatchOverlay({
    title: 'Ky So Nhieu File',
    subtitle: `Dang ky so ${totalCount} file — PIN chi yeu cau 1 lan.`,
    icon: '📄',
    totalCount
  });

  // Build one payload — main process reads bytes directly from filePath
  const batchPayloads = pendingFiles.map((file) => {
    const { pageIndex, viewport, screenRect } = file.selection;
    const page = file.pdfDoc.getPages()[pageIndex];
    const pdfWidth = page.getWidth();
    const pdfHeight = page.getHeight();
    const scaleX = pdfWidth / viewport.width;
    const scaleY = pdfHeight / viewport.height;
    const x1 = screenRect.left * scaleX;
    const y1 = pdfHeight - ((screenRect.top + screenRect.height) * scaleY);
    const x2 = x1 + screenRect.width * scaleX;
    const y2 = y1 + screenRect.height * scaleY;

    return {
      id: file.id,
      filePath: file.filePath,
      pageIndex,
      widgetRect: [x1, y1, x2, y2],
      signerName,
      reason: 'Ky so USB token batch',
      location: 'Vietnam'
    };
  });

  try {
    updateBatchProgress(1, totalCount, 'Dang ky... (PIN chi yeu cau 1 lan)');

    // Single IPC call — PIN prompts only ONCE
    const results = await window.pdfDesktopApi.signBatchWithUsb({
      files: batchPayloads,
      certThumbprint: thumbprint
    });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      const file = state.files.find((f) => f.id === result.id);
      if (!file) continue;

      if (result.error) {
        file.status = 'error';
        file.errorMessage = result.error;
        failCount++;
        updateBatchProgress(i + 1, totalCount, `${file.fileName} — LOI: ${result.error}`);
      } else {
        try {
          const signedBytes = base64ToUint8Array(result.data);
          await saveSignedFile(file, signedBytes, '-signed');
          file.signedBytes = signedBytes;
          file.status = 'signed';
          successCount++;
          updateBatchProgress(i + 1, totalCount, `${file.fileName} ✅`);
        } catch (err) {
          file.status = 'error';
          file.errorMessage = err.message;
          failCount++;
          updateBatchProgress(i + 1, totalCount, `${file.fileName} — LOI: ${err.message}`);
          console.error(`[Save] ${file.fileName} failed:`, err);
        }
      }

      renderFileQueue();
    }

    // If there were failures, show log file path
    if (failCount > 0 && results[0]?.logPath) {
      setStatus(`Ky so xong: ${successCount} thanh cong, ${failCount} that bai. Log: ${results[0].logPath}`);
    }

    hideBatchOverlay(totalCount, totalCount, successCount, failCount);

    if (failCount === 0) {
      setStatus(`Da ky so thanh cong ${successCount} file. Tat ca da duoc luu.`);
    } else {
      setStatus(`Ky so xong: ${successCount} thanh cong, ${failCount} that bai. Log: ${results[0]?.logPath || ''}`);
    }
  } catch (error) {
    console.error('Batch sign failed:', error);
    setStatus(`Ky so that bai (loi chinh): ${error.message}`);
    hideBatchOverlay(0, totalCount, 0, totalCount);
  }

  updateButtonStates();
}

// ── Batch Contractor Sign ──
async function handleBatchContractorSign() {
  if (!contractorCertSelect.value) {
    setStatus('Can chon chung thu WINCA (Nha Thau) truoc khi ky so nhieu file.');
    return;
  }

  const pendingFiles = state.files.filter((f) => f.status === 'pending');
  if (pendingFiles.length === 0) {
    setStatus('Khong co file nao cho ky so nhieu file.');
    return;
  }

  const missingSelection = pendingFiles.filter((f) => !f.selection);
  if (missingSelection.length > 0) {
    setStatus(`Cac file sau chua co vung ky: ${missingSelection.map((f) => f.fileName).join(', ')}`);
    return;
  }

  const signerName = contractorNameInput.value.trim() || trimSubject(
    state.contractorCerts?.find((c) => c.thumbprint === contractorCertSelect.value)?.subject || ''
  );
  const location = contractorAddressInput.value.trim() || 'Vietnam';

  const totalCount = pendingFiles.length;
  state.batchCancelled = false;

  showBatchOverlay({
    title: 'Ky So Nha Thau — Nhieu File',
    subtitle: `Dang ky so ${totalCount} file — PIN chi yeu cau 1 lan.`,
    icon: '🏢',
    totalCount
  });

  const batchPayloads = pendingFiles.map((file) => {
    const { pageIndex, viewport, screenRect } = file.selection;
    const page = file.pdfDoc.getPages()[pageIndex];
    const pdfWidth = page.getWidth();
    const pdfHeight = page.getHeight();
    const scaleX = pdfWidth / viewport.width;
    const scaleY = pdfHeight / viewport.height;
    const x1 = screenRect.left * scaleX;
    const y1 = pdfHeight - ((screenRect.top + screenRect.height) * scaleY);
    const x2 = x1 + screenRect.width * scaleX;
    const y2 = y1 + screenRect.height * scaleY;

    return {
      id: file.id,
      filePath: file.filePath,
      pageIndex,
      widgetRect: [x1, y1, x2, y2],
      signerName,
      reason: 'Ky so Dai Dien Nha Thau',
      location,
      signatureImageName: 'Signature_2.png'
    };
  });

  try {
    updateBatchProgress(1, totalCount, 'Dang ky... (PIN chi yeu cau 1 lan)');

    const results = await window.pdfDesktopApi.signBatchWithUsb({
      files: batchPayloads,
      certThumbprint: contractorCertSelect.value
    });

    let successCount = 0;
    let failCount = 0;

    for (let i = 0; i < results.length; i++) {
      const { id, data } = results[i];
      const file = state.files.find((f) => f.id === id);
      if (!file) continue;

      try {
        const signedBytes = base64ToUint8Array(data);
        await saveSignedFile(file, signedBytes, '-nha-thau-signed');
        file.signedBytes = signedBytes;
        file.status = 'signed';
        successCount++;
      } catch (err) {
        file.status = 'error';
        file.errorMessage = err.message;
        failCount++;
      }

      updateBatchProgress(i + 1, totalCount, file.fileName);
      renderFileQueue();
    }

    hideBatchOverlay(totalCount, totalCount, successCount, failCount);

    if (failCount === 0) {
      setStatus(`Da ky so Dai Dien Nha Thau thanh cong ${successCount} file.`);
    } else {
      setStatus(`Ky so Nha Thau: ${successCount} thanh cong, ${failCount} that bai.`);
    }
  } catch (error) {
    console.error('Batch contractor sign failed:', error);
    setStatus(`Ky so Nha Thau that bai: ${error.message}`);
    hideBatchOverlay(0, totalCount, 0, totalCount);
  }

  updateButtonStates();
}

// ═══════════════════════════════════════════════════════
//  BATCH OVERLAY UI
// ═══════════════════════════════════════════════════════

function showBatchOverlay({ title, subtitle, icon, totalCount }) {
  batchOverlayIcon.textContent = icon;
  batchOverlayTitle.textContent = title;
  batchOverlaySubtitle.textContent = subtitle;
  batchProgressBar.style.width = '0%';
  batchProgressText.textContent = `0 / ${totalCount} file`;
  batchFileText.textContent = 'Dang bat dau...';
  batchSummary.classList.add('hidden');
  batchCancelBtn.textContent = 'Huy ky';
  batchCancelBtn.style.display = '';
  batchOverlay.classList.remove('hidden');
  state.batchActive = true;
}

function updateBatchProgress(current, total, fileName) {
  const pct = Math.round((current / total) * 100);
  batchProgressBar.style.width = `${pct}%`;
  batchProgressText.textContent = `${current} / ${total} file`;
  batchFileText.textContent = fileName;
  batchFileText.title = fileName;
}

function updateBatchOverlayCancelled(processedCount, totalCount, failCount) {
  const pct = Math.round((processedCount / totalCount) * 100);
  batchProgressBar.style.width = `${pct}%`;
  batchProgressText.textContent = `${processedCount} / ${totalCount} file`;
  batchOverlayTitle.textContent = 'Da huy ky so';
  batchOverlaySubtitle.textContent = `Ky so da bi huy boi nguoi dung.`;
  batchCancelBtn.textContent = 'Dong';
  batchCancelBtn.style.display = '';
  state.batchActive = false;

  const successCount = processedCount - failCount;
  document.getElementById('summary-total').textContent = totalCount;
  document.getElementById('summary-success').textContent = successCount;
  document.getElementById('summary-fail').textContent = failCount;
  batchSummary.classList.remove('hidden');
}

function hideBatchOverlay(processedCount, totalCount, successCount, failCount) {
  batchProgressBar.style.width = '100%';
  batchOverlayIcon.textContent = failCount === 0 ? '✅' : '⚠️';
  batchOverlayTitle.textContent = failCount === 0
    ? 'Ky so nhieu file hoan tat!'
    : 'Ky so nhieu file hoan tat (co loi)';
  batchOverlaySubtitle.textContent = failCount === 0
    ? `Tat ca ${successCount} file da duoc ky so va luu thanh cong.`
    : `${successCount} file thanh cong, ${failCount} file that bai.`;
  batchCancelBtn.textContent = 'Dong';
  batchCancelBtn.style.display = '';

  document.getElementById('summary-total').textContent = totalCount;
  document.getElementById('summary-success').textContent = successCount;
  document.getElementById('summary-fail').textContent = failCount;
  batchSummary.classList.remove('hidden');

  state.batchActive = false;
}

function closeBatchOverlay() {
  batchOverlay.classList.add('hidden');
}

// ═══════════════════════════════════════════════════════
//  SAVE PDF
// ═══════════════════════════════════════════════════════

async function handleSavePdf() {
  const file = getCurrentFile();
  if (!file || file.placements.length === 0) return;

  setStatus('Dang luu file PDF da ky...');
  const savedBytes = await file.pdfDoc.save();
  const suggestedName = file.fileName
    ? file.fileName.replace(/\.pdf$/i, '') + '-signed.pdf'
    : 'signed-document.pdf';

  const result = await window.pdfDesktopApi.savePdf({
    originalPath: file.filePath,
    suggestedName,
    data: uint8ArrayToBase64(savedBytes)
  });

  if (result?.filePath) {
    setStatus(`Da luu file tai: ${result.filePath}`);
  } else {
    setStatus('Ban da huy thao tac luu file.');
  }
}

// ═══════════════════════════════════════════════════════
//  UTILITY
// ═══════════════════════════════════════════════════════

function setStatus(message) {
  statusText.textContent = message;
}

function clearSelectionVisuals() {
  document.querySelectorAll('.selection-box').forEach((n) => n.remove());
}

function restoreSelectionVisual(file) {
  if (!file.selection) return;
  const page = file.pages.find((p) => p.pageIndex === file.selection.pageIndex);
  if (!page) return;

  const sel = file.selection.screenRect;
  const box = document.createElement('div');
  box.className = 'selection-box';
  box.style.left = `${sel.left}px`;
  box.style.top = `${sel.top}px`;
  box.style.width = `${sel.width}px`;
  box.style.height = `${sel.height}px`;
  page.wrapper.appendChild(box);
}

function clearSignaturePreviews() {
  document.querySelectorAll('.signature-preview').forEach((n) => n.remove());
}

function trimSubject(subject) {
  return subject.replace(/^.*CN=/, '').split(',')[0].trim();
}

function formatDate(dateValue) {
  return new Date(dateValue).toLocaleDateString('vi-VN');
}

function escapeHtml(value) {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function base64ToUint8Array(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}
