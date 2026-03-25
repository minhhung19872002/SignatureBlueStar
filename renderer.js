const state = {
  filePath: null,
  fileName: null,
  pdfBytes: null,
  pdfDoc: null,
  pdfJsDoc: null,
  pdfjsLib: null,
  pages: [],
  selection: null,
  placements: [],
  certificates: []
};

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

openFileBtn.addEventListener('click', handleOpenPdf);
applySignatureBtn.addEventListener('click', handleApplySignature);
saveFileBtn.addEventListener('click', handleSavePdf);
usbSignBtn.addEventListener('click', handleUsbSign);
fontSizeInput.addEventListener('input', () => {
  fontSizeLabel.textContent = `${fontSizeInput.value} px`;
});
certificateSelect.addEventListener('change', updateUsbButtonState);

setStatus('San sang. Hay mo mot file PDF de bat dau.');
loadCertificates();

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

async function loadCertificates() {
  if (!window.pdfDesktopApi?.listCertificates) {
    certificateSelect.innerHTML = '<option value="">Khong co bridge ky so</option>';
    return;
  }

  try {
    const certificates = await window.pdfDesktopApi.listCertificates();
    state.certificates = certificates;

    if (certificates.length === 0) {
      certificateSelect.innerHTML = '<option value="">Khong tim thay chung thu WINCA</option>';
      usbSignBtn.disabled = true;
      return;
    }

    certificateSelect.innerHTML = certificates
      .map((cert, index) => {
        const label = `${index + 1}. ${trimSubject(cert.subject)} | ${formatDate(cert.notAfter)}`;
        return `<option value="${escapeHtml(cert.thumbprint)}">${escapeHtml(label)}</option>`;
      })
      .join('');

    updateUsbButtonState();
  } catch (error) {
    console.error(error);
    certificateSelect.innerHTML = '<option value="">Tai chung thu that bai</option>';
    usbSignBtn.disabled = true;
    setStatus(`Khong tai duoc danh sach chung thu: ${error.message}`);
  }
}

function updateUsbButtonState() {
  usbSignBtn.disabled = !state.selection || !certificateSelect.value;
}

function setStatus(message) {
  statusText.textContent = message;
}

function clearSelectionVisuals() {
  document.querySelectorAll('.selection-box').forEach((node) => node.remove());
}

function clearSignaturePreviews() {
  document.querySelectorAll('.signature-preview').forEach((node) => node.remove());
}

async function handleOpenPdf() {
  if (!window.pdfDesktopApi?.openPdf) {
    setStatus('Khong tim thay Electron bridge. Hay tat app va mo lai.');
    return;
  }

  setStatus('Dang mo hop chon file PDF...');

  let result;
  try {
    result = await window.pdfDesktopApi.openPdf();
  } catch (error) {
    console.error(error);
    setStatus(`Mo hop chon file that bai: ${error.message}`);
    return;
  }

  if (!result) {
    setStatus('Ban da huy thao tac mo file.');
    return;
  }

  try {
    await loadPdfBytes(base64ToUint8Array(result.data));
    state.filePath = result.filePath;
    state.fileName = result.fileName;
    fileNameText.textContent = result.fileName;
    setStatus('PDF da duoc tai. Keo chuot tren trang de chon vung ky.');
  } catch (error) {
    console.error(error);
    pdfContainer.innerHTML = '';
    emptyState.classList.remove('hidden');
    pdfContainer.classList.add('hidden');
    setStatus(`Khong the doc file PDF: ${error.message}`);
  }
}

async function loadPdfBytes(rawBytes) {
  const { pdfjsLib, PDFLib } = await ensurePdfLibraries();
  const { PDFDocument } = PDFLib;

  state.pdfBytes = rawBytes;
  state.selection = null;
  state.placements = [];
  applySignatureBtn.disabled = true;
  saveFileBtn.disabled = true;
  updateUsbButtonState();

  emptyState.classList.add('hidden');
  pdfContainer.classList.remove('hidden');
  pdfContainer.innerHTML = '';

  state.pdfDoc = await PDFDocument.load(rawBytes);
  state.pdfJsDoc = await pdfjsLib.getDocument({ data: rawBytes }).promise;
  state.pages = await renderAllPages(state.pdfJsDoc);
}

async function renderAllPages(pdfJsDoc) {
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
    await page.render({
      canvasContext: context,
      viewport
    }).promise;

    bindSelectionEvents(wrapper, viewport, pageIndex - 1);
    pages.push({ pageIndex: pageIndex - 1, viewport, wrapper, canvas });
  }

  state.placements.forEach(addSignaturePreview);
  return pages;
}

function bindSelectionEvents(wrapper, viewport, pageIndex) {
  let startX = 0;
  let startY = 0;
  let selectionBox = null;
  let isDragging = false;

  wrapper.onpointerdown = (event) => {
    clearSelectionVisuals();
    state.selection = null;
    applySignatureBtn.disabled = true;
    updateUsbButtonState();

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
    if (!isDragging || !selectionBox) {
      return;
    }

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
    if (!isDragging || !selectionBox) {
      return;
    }

    isDragging = false;
    wrapper.releasePointerCapture(event.pointerId);

    const left = parseFloat(selectionBox.style.left);
    const top = parseFloat(selectionBox.style.top);
    const width = parseFloat(selectionBox.style.width);
    const height = parseFloat(selectionBox.style.height);

    if (width < 16 || height < 16) {
      selectionBox.remove();
      state.selection = null;
      applySignatureBtn.disabled = true;
      updateUsbButtonState();
      setStatus('Vung chon qua nho. Hay keo lai de chon vung rong hon.');
      return;
    }

    state.selection = {
      pageIndex,
      viewport,
      screenRect: { left, top, width, height }
    };
    applySignatureBtn.disabled = false;
    updateUsbButtonState();
    setStatus(`Da chon vung tren trang ${pageIndex + 1}. Co the chen chu ky hoac ky so USB.`);
  };
}

function addSignaturePreview(placement) {
  const page = state.pages.find((item) => item.pageIndex === placement.pageIndex);
  if (!page) {
    return;
  }

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
  if (placement.subtitle) {
    preview.appendChild(sub);
  }
  page.wrapper.appendChild(preview);
}

async function handleApplySignature() {
  if (!state.selection || !state.pdfDoc || !window.PDFLib) {
    return;
  }

  const signatureText = signatureTextInput.value.trim();
  if (!signatureText) {
    setStatus('Can nhap noi dung chu ky truoc khi chen vao PDF.');
    signatureTextInput.focus();
    return;
  }

  const { StandardFonts, rgb } = window.PDFLib;
  const subtitle = signatureSubtitleInput.value.trim();
  const fontSize = Number(fontSizeInput.value);
  const { pageIndex, viewport, screenRect } = state.selection;
  const page = state.pdfDoc.getPages()[pageIndex];
  const pdfWidth = page.getWidth();
  const pdfHeight = page.getHeight();

  const scaleX = pdfWidth / viewport.width;
  const scaleY = pdfHeight / viewport.height;
  const pdfX = screenRect.left * scaleX;
  const pdfWidthRect = screenRect.width * scaleX;
  const pdfHeightRect = screenRect.height * scaleY;
  const pdfY = pdfHeight - ((screenRect.top + screenRect.height) * scaleY);

  const cursiveFont = await state.pdfDoc.embedFont(StandardFonts.HelveticaOblique);
  const normalFont = await state.pdfDoc.embedFont(StandardFonts.Helvetica);
  const bodyFontSize = Math.max(10, fontSize * scaleY);
  const subtitleFontSize = Math.max(8, bodyFontSize * 0.38);
  const subtitleYOffset = subtitle ? subtitleFontSize + 6 : 0;

  page.drawRectangle({
    x: pdfX,
    y: pdfY,
    width: pdfWidthRect,
    height: pdfHeightRect,
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

  state.placements.push(placement);
  clearSelectionVisuals();
  clearSignaturePreviews();
  state.placements.forEach(addSignaturePreview);
  state.selection = null;
  applySignatureBtn.disabled = true;
  saveFileBtn.disabled = false;
  updateUsbButtonState();
  setStatus(`Da chen chu ky vao trang ${pageIndex + 1}. Co the luu file PDF.`);
}

async function handleUsbSign() {
  if (!state.selection) {
    setStatus('Can chon vung ky tren PDF truoc.');
    return;
  }

  if (!certificateSelect.value) {
    setStatus('Can chon chung thu WINCA truoc khi ky so.');
    return;
  }

  try {
    setStatus('Dang chuan bi du lieu ky so...');
    const currentBytes = await state.pdfDoc.save();
    const { pageIndex, viewport, screenRect } = state.selection;
    const page = state.pdfDoc.getPages()[pageIndex];
    const pdfWidth = page.getWidth();
    const pdfHeight = page.getHeight();
    const scaleX = pdfWidth / viewport.width;
    const scaleY = pdfHeight / viewport.height;
    const x1 = screenRect.left * scaleX;
    const y1 = pdfHeight - ((screenRect.top + screenRect.height) * scaleY);
    const x2 = x1 + screenRect.width * scaleX;
    const y2 = y1 + screenRect.height * scaleY;
    const selectedCert = state.certificates.find((item) => item.thumbprint === certificateSelect.value);

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
    await loadPdfBytes(signedBytes);

    const suggestedName = state.fileName
      ? state.fileName.replace(/\.pdf$/i, '') + '-usb-signed.pdf'
      : 'usb-signed.pdf';

    const saveResult = await window.pdfDesktopApi.savePdf({
      originalPath: state.filePath,
      suggestedName,
      data: signed.data
    });

    if (saveResult?.filePath) {
      saveFileBtn.disabled = false;
      setStatus(`Da ky so WINCA va luu file tai: ${saveResult.filePath}`);
    } else {
      setStatus('Da ky so thanh cong, nhung ban huy thao tac luu file.');
    }
  } catch (error) {
    console.error(error);
    setStatus(`Ky so USB that bai: ${error.message}`);
  }
}

async function handleSavePdf() {
  if (!state.pdfDoc || state.placements.length === 0) {
    return;
  }

  setStatus('Dang luu file PDF da ky...');
  const savedBytes = await state.pdfDoc.save();
  const suggestedName = state.fileName
    ? state.fileName.replace(/\.pdf$/i, '') + '-signed.pdf'
    : 'signed-document.pdf';

  const result = await window.pdfDesktopApi.savePdf({
    originalPath: state.filePath,
    suggestedName,
    data: uint8ArrayToBase64(savedBytes)
  });

  if (result?.filePath) {
    setStatus(`Da luu file tai: ${result.filePath}`);
  } else {
    setStatus('Ban da huy thao tac luu file.');
  }
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

  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }

  return bytes;
}

function uint8ArrayToBase64(bytes) {
  let binary = '';
  const chunkSize = 0x8000;

  for (let index = 0; index < bytes.length; index += chunkSize) {
    const chunk = bytes.subarray(index, index + chunkSize);
    binary += String.fromCharCode(...chunk);
  }

  return btoa(binary);
}
