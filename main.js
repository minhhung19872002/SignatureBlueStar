const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const fs = require('fs/promises');
const fssync = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { PDFDocument } = require('pdf-lib');
const { pdflibAddPlaceholder } = require('@signpdf/placeholder-pdf-lib');
const signpdf = require('@signpdf/signpdf').default;
const { Signer } = require('@signpdf/signpdf');
const { SUBFILTER_ADOBE_PKCS7_DETACHED } = require('@signpdf/utils');

function createWindow() {
  const win = new BrowserWindow({
    width: 1440,
    height: 980,
    minWidth: 1100,
    minHeight: 720,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  win.loadFile('index.html');
}

app.whenReady().then(() => {
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

class WindowsStoreSigner extends Signer {
  constructor(thumbprint) {
    super();
    this.thumbprint = thumbprint;
  }

  async sign(pdfBuffer) {
    const helperPath = resolveSignerHelperPath();
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'signature-blue-star-'));
    const inputPath = path.join(tempDir, 'payload.bin');
    const outputPath = path.join(tempDir, 'signature.bin');

    try {
      await fs.writeFile(inputPath, pdfBuffer);
      await runHelper(['sign', this.thumbprint, inputPath, outputPath], helperPath);
      return await fs.readFile(outputPath);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }
}

ipcMain.handle('pdf:open', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open PDF',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const filePath = result.filePaths[0];
  const bytes = await fs.readFile(filePath);

  return {
    filePath,
    fileName: path.basename(filePath),
    data: bytes.toString('base64')
  };
});

ipcMain.handle('pdf:openMultiple', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Open Multiple PDFs',
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }],
    properties: ['openFile', 'multiSelections']
  });

  if (result.canceled || result.filePaths.length === 0) {
    return [];
  }

  const files = await Promise.all(
    result.filePaths.map(async (filePath) => {
      const bytes = await fs.readFile(filePath);
      return {
        filePath,
        fileName: path.basename(filePath),
        data: bytes.toString('base64')
      };
    })
  );

  return files;
});

ipcMain.handle('pdf:save', async (_, payload) => {
  const { originalPath, suggestedName, data } = payload;
  const saveResult = await dialog.showSaveDialog({
    title: 'Save Signed PDF',
    defaultPath: originalPath
      ? path.join(path.dirname(originalPath), suggestedName)
      : suggestedName,
    filters: [{ name: 'PDF Files', extensions: ['pdf'] }]
  });

  if (saveResult.canceled || !saveResult.filePath) {
    return null;
  }

  await fs.writeFile(saveResult.filePath, Buffer.from(data, 'base64'));
  return { filePath: saveResult.filePath };
});

ipcMain.handle('signer:listCertificates', async () => {
  const helperPath = resolveSignerHelperPath();
  const output = await runHelper(['list'], helperPath);
  return JSON.parse(output || '[]');
});

// Cache for the batch session key handle — once PIN is entered, reuse it
let _batchSessionKeyHandle = null;
let _batchSessionThumbprint = null;

ipcMain.handle('pdf:signWithUsb', async (_, payload) => {
  const {
    data,
    certThumbprint,
    pageIndex,
    widgetRect,
    signerName,
    reason,
    location
  } = payload;

  const pdfBytes = Buffer.from(data, 'base64');
  const pdfDoc = await PDFDocument.load(pdfBytes);
  const pdfPage = pdfDoc.getPages()[pageIndex];

  await drawVisibleSignatureBlock(pdfDoc, pdfPage, widgetRect);

  pdflibAddPlaceholder({
    pdfDoc,
    pdfPage,
    reason: reason || 'Signed with WINCA USB token',
    contactInfo: signerName || '',
    name: signerName || 'WINCA Signer',
    location: location || 'Vietnam',
    signatureLength: 16000,
    subFilter: SUBFILTER_ADOBE_PKCS7_DETACHED,
    widgetRect,
    appName: 'Signature Blue Star'
  });

  const pdfWithPlaceholder = Buffer.from(
    await pdfDoc.save({ useObjectStreams: false })
  );

  const signer = new WindowsStoreSigner(certThumbprint);
  const signedPdf = await signpdf.sign(pdfWithPlaceholder, signer);

  return {
    data: Buffer.from(signedPdf).toString('base64')
  };
});

// Batch USB sign — one IPC call, PIN prompts ONCE via signbatch
ipcMain.handle('pdf:signBatchWithUsb', async (_, payload) => {
  const { files, certThumbprint } = payload;
  const helperPath = resolveSignerHelperPath();
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'sign-batch-'));
  const logPath = path.join(os.tmpdir(), 'sign-batch-error.log');
  let logLines = [`[${new Date().toISOString()}] Bat dau ky so batch — ${files.length} file\n`];

  const writeLog = (line) => {
    logLines.push(line + '\n');
  };

  try {
    // Step 1: Draw signature + add placeholder for each file, save to temp
    const inputOutputPairs = [];

    for (const f of files) {
      writeLog(`[${f.id}] Preparing PDF...`);
      const pdfBytes = await fs.readFile(f.filePath);
      const pdfDoc = await PDFDocument.load(pdfBytes);
      const pdfPage = pdfDoc.getPages()[f.pageIndex];

      await drawVisibleSignatureBlock(pdfDoc, pdfPage, f.widgetRect);

      pdflibAddPlaceholder({
        pdfDoc,
        pdfPage,
        reason: f.reason || 'Signed with WINCA USB token',
        contactInfo: f.signerName || '',
        name: f.signerName || 'WINCA Signer',
        location: f.location || 'Vietnam',
        signatureLength: 16000,
        subFilter: SUBFILTER_ADOBE_PKCS7_DETACHED,
        widgetRect: f.widgetRect,
        appName: 'Signature Blue Star'
      });

      const pdfWithPlaceholder = Buffer.from(
        await pdfDoc.save({ useObjectStreams: false })
      );

      const inputPath = path.join(tempDir, `${f.id}.pdf`);
      const outputPath = path.join(tempDir, `${f.id}-signed.pdf`);
      await fs.writeFile(inputPath, pdfWithPlaceholder);
      writeLog(`[${f.id}] Temp PDF size: ${pdfWithPlaceholder.length}`);
      inputOutputPairs.push({ id: f.id, inputPath, outputPath });
    }

    // Step 2: Call signbatch ONCE — PIN prompted HERE and cached for all files
    const signArgs = ['signbatch', certThumbprint];
    for (const pair of inputOutputPairs) {
      signArgs.push(pair.inputPath, pair.outputPath);
    }

    writeLog('Calling signbatch (PIN will prompt once)...');
    let signOutput = '';
    try {
      signOutput = await runHelper(signArgs, helperPath);
      writeLog(`signbatch result: ${signOutput}`);
    } catch (err) {
      writeLog(`signbatch error: ${err.message}`);
    }

    // Step 3: Read signed PDFs
    const results = [];
    const outputByInput = {};

    if (signOutput) {
      try {
        const signResults = JSON.parse(signOutput);
        for (const sr of signResults) {
          outputByInput[sr.input] = sr;
        }
      } catch (err) {
        writeLog(`JSON parse error: ${err.message}`);
      }
    }

    for (const pair of inputOutputPairs) {
      const sr = outputByInput[pair.inputPath];
      if (sr?.success) {
        try {
          const signedBytes = await fs.readFile(pair.outputPath);
          writeLog(`[${pair.id}] Signed PDF size: ${signedBytes.length}`);
          results.push({ id: pair.id, data: Buffer.from(signedBytes).toString('base64') });
        } catch (err) {
          writeLog(`[${pair.id}] Read error: ${err.message}`);
          results.push({ id: pair.id, error: `Loi doc file da ky: ${err.message}` });
        }
      } else {
        const errMsg = sr?.error || 'signbatch khong tra ket qua';
        writeLog(`[${pair.id}] Failed: ${errMsg}`);
        results.push({ id: pair.id, error: errMsg });
      }
    }

    await fs.writeFile(logPath, logLines.join(''));
    return results;
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
});

async function drawVisibleSignatureBlock(pdfDoc, pdfPage, widgetRect) {
  const [x1, y1, x2, y2] = widgetRect;
  const width = Math.max(10, x2 - x1);
  const height = Math.max(10, y2 - y1);
  const signatureBytes = await fs.readFile(resolveSignatureImagePath());
  const signatureImage = await pdfDoc.embedPng(signatureBytes);
  const imageRatio = signatureImage.width / signatureImage.height;

  let drawWidth = width;
  let drawHeight = drawWidth / imageRatio;

  if (drawHeight > height) {
    drawHeight = height;
    drawWidth = drawHeight * imageRatio;
  }

  pdfPage.drawImage(signatureImage, {
    x: x1 + (width - drawWidth) / 2,
    y: y1 + (height - drawHeight) / 2,
    width: drawWidth,
    height: drawHeight,
    opacity: 0.98
  });
}

function resolveSignerHelperPath() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'SignerHelper', 'publish', 'SignerHelper.exe'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'SignerHelper', 'publish', 'SignerHelper.exe')
      ]
    : [
        path.join(__dirname, 'SignerHelper', 'publish', 'SignerHelper.exe')
      ];

  const helperPath = candidates.find((candidate) => fssync.existsSync(candidate));
  if (!helperPath) {
    throw new Error('Signer helper was not found. Run npm run build:signer first.');
  }

  return helperPath;
}

function resolveSignatureImagePath() {
  const candidates = app.isPackaged
    ? [
        path.join(process.resourcesPath, 'Signature.png'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'Signature.png')
      ]
    : [
        path.join(__dirname, 'Signature.png')
      ];

  const imagePath = candidates.find((candidate) => fssync.existsSync(candidate));
  if (!imagePath) {
    throw new Error('Signature image was not found.');
  }

  return imagePath;
}

function runHelper(args, helperPath) {
  return new Promise((resolve, reject) => {
    const child = spawn(helperPath, args, {
      windowsHide: false
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve(stdout.trim());
        return;
      }

      // Non-zero exit: still resolve if stdout has content (e.g. partial JSON results)
      if (stdout.trim()) {
        resolve(stdout.trim());
        return;
      }

      reject(new Error(stderr.trim() || `Signer helper failed with code ${code}.`));
    });
  });
}
