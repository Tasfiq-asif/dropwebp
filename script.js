import { encode } from "@jsquash/webp";
import JSZip from "jszip";

const fileInput = document.querySelector("#fileInput");
const dropZone = document.querySelector("#dropZone");
const previewWrap = document.querySelector("#previewWrap");
const imagePreview = document.querySelector("#imagePreview");
const fileInfo = document.querySelector("#fileInfo");
const fileName = document.querySelector("#fileName");
const fileType = document.querySelector("#fileType");
const fileSize = document.querySelector("#fileSize");
const imageDimensions = document.querySelector("#imageDimensions");
const batchList = document.querySelector("#batchList");
const batchCount = document.querySelector("#batchCount");
const batchTotalSize = document.querySelector("#batchTotalSize");
const fileList = document.querySelector("#fileList");
const qualityInput = document.querySelector("#qualityInput");
const qualityValue = document.querySelector("#qualityValue");
const convertButton = document.querySelector("#convertButton");
const downloadButton = document.querySelector("#downloadButton");
const resetButton = document.querySelector("#resetButton");
const statusMessage = document.querySelector("#statusMessage");
const estimateBox = document.querySelector("#estimateBox");
const estimateSize = document.querySelector("#estimateSize");
const estimateNote = document.querySelector("#estimateNote");
const resultBox = document.querySelector("#resultBox");
const outputName = document.querySelector("#outputName");
const outputSize = document.querySelector("#outputSize");

const allowedTypes = new Set(["image/jpeg", "image/png"]);
const batchZipName = "webp-converted-images.zip";

let batchItems = [];
let outputUrl = null;
let estimateTimer = null;
let estimateRequestId = 0;
let isConverting = false;
let downloadsEnabled = false;

qualityInput.addEventListener("input", () => {
  qualityValue.textContent = `${qualityInput.value}%`;
  resetOutputState();

  if (batchItems.length > 0) {
    clearEncodedOutputs();
    renderFileList();
    scheduleBatchEstimate();
    setStatus("Quality changed. The batch estimate will update automatically.");
  }
});

fileInput.addEventListener("change", (event) => {
  handleFiles([...event.target.files]);
});

dropZone.addEventListener("dragenter", handleDragEnter);
dropZone.addEventListener("dragover", handleDragEnter);
dropZone.addEventListener("dragleave", (event) => {
  if (!dropZone.contains(event.relatedTarget)) {
    dropZone.classList.remove("is-dragging");
  }
});

dropZone.addEventListener("drop", (event) => {
  event.preventDefault();
  dropZone.classList.remove("is-dragging");
  handleFiles([...event.dataTransfer.files]);
});

convertButton.addEventListener("click", () => {
  convertBatch();
});

resetButton.addEventListener("click", resetApp);

downloadButton.addEventListener("click", (event) => {
  if (downloadButton.classList.contains("disabled")) {
    event.preventDefault();
  }
});

function handleDragEnter(event) {
  event.preventDefault();
  dropZone.classList.add("is-dragging");
}

async function handleFiles(files) {
  resetAppStateForNewFiles();

  const validFiles = files.filter((file) => allowedTypes.has(file.type));
  const rejectedCount = files.length - validFiles.length;

  if (validFiles.length === 0) {
    setStatus("Unsupported file type. Choose JPG, JPEG, or PNG images.", true);
    return;
  }

  setStatus(`Loading ${validFiles.length} image${validFiles.length === 1 ? "" : "s"} locally...`);

  const loadedItems = await Promise.all(validFiles.map(loadBatchItem));
  batchItems = loadedItems.filter(Boolean);

  if (batchItems.length === 0) {
    setStatus("None of those images could be decoded. Try different JPG or PNG files.", true);
    return;
  }

  updateSourceSummary();
  renderFileList();
  convertButton.disabled = false;
  resetButton.disabled = false;
  scheduleBatchEstimate();

  const rejectedText = rejectedCount > 0 ? ` ${rejectedCount} unsupported file${rejectedCount === 1 ? " was" : "s were"} skipped.` : "";
  setStatus(`${batchItems.length} image${batchItems.length === 1 ? "" : "s"} ready for batch conversion.${rejectedText}`);
}

function loadBatchItem(file, index) {
  return new Promise((resolve) => {
    const image = new Image();
    const previewUrl = URL.createObjectURL(file);

    image.addEventListener("load", () => {
      resolve({
        id: `${file.name}-${file.size}-${file.lastModified}-${index}`,
        file,
        image,
        previewUrl,
        width: image.naturalWidth,
        height: image.naturalHeight,
        status: "ready",
        outputBlob: null,
        outputUrl: null,
        error: "",
      });
    });

    image.addEventListener("error", () => {
      URL.revokeObjectURL(previewUrl);
      resolve(null);
    });

    image.src = previewUrl;
  });
}

async function convertBatch() {
  if (batchItems.length === 0 || isConverting) {
    return;
  }

  isConverting = true;
  convertButton.disabled = true;
  clearEstimateTimer();
  resetOutputState();
  setStatus(`Converting 1 of ${batchItems.length} with libwebp WebAssembly...`);

  const quality = Number(qualityInput.value);

  for (const [index, item] of batchItems.entries()) {
    if (!item.outputBlob) {
      item.status = "encoding";
      renderFileList();
      setStatus(`Converting ${index + 1} of ${batchItems.length}: ${item.file.name}`);
      await encodeItem(item, quality);
    }
  }

  const successfulItems = batchItems.filter((item) => item.outputBlob);
  if (successfulItems.length === 0) {
    isConverting = false;
    convertButton.disabled = false;
    setStatus("The WebP encoder failed for every image. Try smaller files or refresh the app.", true);
    return;
  }

  const zipBlob = await createZipBlob(successfulItems);
  prepareZipDownload(zipBlob, successfulItems);
  updateBatchEstimate(successfulItems);
  renderFileList();
  isConverting = false;
  convertButton.disabled = false;

  const failedCount = batchItems.length - successfulItems.length;
  const failedText = failedCount > 0 ? ` ${failedCount} image${failedCount === 1 ? "" : "s"} failed.` : "";
  setStatus(`Batch conversion complete. ${successfulItems.length} WebP file${successfulItems.length === 1 ? "" : "s"} ready.${failedText}`, false, true);
}

async function encodeItem(item, quality) {
  try {
    const blob = await createWebpBlob(item, quality);
    if (!blob) {
      item.status = "error";
      item.error = "Encoding failed";
      return;
    }

    revokeItemOutput(item);
    item.outputBlob = blob;
    item.outputUrl = URL.createObjectURL(blob);
    item.status = "done";
    item.error = "";
  } catch (error) {
    console.error(error);
    item.status = "error";
    item.error = "Encoding failed";
  }
}

async function createWebpBlob(item, quality) {
  const canvas = document.createElement("canvas");
  canvas.width = item.width;
  canvas.height = item.height;

  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }

  context.drawImage(item.image, 0, 0, item.width, item.height);
  const imageData = context.getImageData(0, 0, item.width, item.height);
  const webpBuffer = await encode(imageData, {
    quality,
    method: 6,
    alpha_quality: quality,
    thread_level: 1,
    use_sharp_yuv: 1,
  });

  return new Blob([webpBuffer], { type: "image/webp" });
}

async function createZipBlob(items) {
  const zip = new JSZip();

  for (const item of items) {
    zip.file(getWebpName(item.file.name), item.outputBlob);
  }

  return zip.generateAsync({ type: "blob" });
}

function scheduleBatchEstimate() {
  clearEstimateTimer();
  estimateRequestId += 1;

  if (batchItems.length === 0) {
    hideEstimate();
    return;
  }

  estimateBox.hidden = false;
  estimateSize.textContent = "Estimating...";
  estimateNote.textContent = `Encoding ${batchItems.length} image${batchItems.length === 1 ? "" : "s"} locally with current quality.`;

  const requestId = estimateRequestId;
  const quality = Number(qualityInput.value);

  estimateTimer = window.setTimeout(async () => {
    const itemsToEstimate = batchItems.filter((item) => !item.outputBlob);

    for (const item of itemsToEstimate) {
      if (requestId !== estimateRequestId) {
        return;
      }

      item.status = "estimating";
      renderFileList();
      await encodeItem(item, quality);
    }

    if (requestId !== estimateRequestId) {
      return;
    }

    updateBatchEstimate(batchItems.filter((item) => item.outputBlob));
    renderFileList();
  }, 220);
}

function updateSourceSummary() {
  const firstItem = batchItems[0];
  const totalBytes = getSourceTotalBytes();

  imagePreview.src = firstItem.previewUrl;
  previewWrap.hidden = false;
  fileInfo.hidden = false;
  batchList.hidden = false;
  fileName.textContent = batchItems.length === 1 ? firstItem.file.name : `${batchItems.length} images`;
  fileType.textContent = batchItems.length === 1 ? getDisplayType(firstItem.file) : "JPG/PNG batch";
  fileSize.textContent = formatBytes(totalBytes);
  imageDimensions.textContent = batchItems.length === 1 ? `${firstItem.width} x ${firstItem.height}px` : `First: ${firstItem.width} x ${firstItem.height}px`;
  batchCount.textContent = `${batchItems.length} file${batchItems.length === 1 ? "" : "s"} selected`;
  batchTotalSize.textContent = formatBytes(totalBytes);
}

function renderFileList() {
  fileList.innerHTML = "";

  for (const item of batchItems) {
    const row = document.createElement("li");
    row.className = "file-row";

    const main = document.createElement("div");
    main.className = "file-row-main";

    const name = document.createElement("div");
    name.className = "file-row-name";
    name.textContent = item.file.name;

    const meta = document.createElement("div");
    meta.className = "file-row-meta";
    meta.textContent = `${getDisplayType(item.file)} • ${formatBytes(item.file.size)} • ${item.width} x ${item.height}px`;

    const status = document.createElement("div");
    status.className = `file-row-status ${getStatusClass(item)}`;
    status.append(getStatusContent(item));

    main.append(name, meta);
    row.append(main, status);
    fileList.append(row);
  }
}

function getStatusContent(item) {
  if (item.outputBlob && item.outputUrl && downloadsEnabled) {
    const link = document.createElement("a");
    link.className = "file-download";
    link.href = item.outputUrl;
    link.download = getWebpName(item.file.name);
    link.textContent = formatBytes(item.outputBlob.size);
    return link;
  }

  if (item.outputBlob) {
    return formatBytes(item.outputBlob.size);
  }

  if (item.status === "estimating") {
    return "Estimating";
  }

  if (item.status === "encoding") {
    return "Converting";
  }

  if (item.status === "error") {
    return item.error || "Failed";
  }

  return "Ready";
}

function getStatusClass(item) {
  if (item.status === "error") {
    return "error";
  }

  if (item.outputBlob) {
    return "done";
  }

  if (item.status === "ready") {
    return "ready";
  }

  return "";
}

function prepareZipDownload(zipBlob, successfulItems) {
  revokeOutput();
  downloadsEnabled = true;
  outputUrl = URL.createObjectURL(zipBlob);
  downloadButton.href = outputUrl;
  downloadButton.download = batchZipName;
  downloadButton.classList.remove("disabled");
  downloadButton.setAttribute("aria-disabled", "false");

  outputName.textContent = batchItems.length === 1 ? getWebpName(successfulItems[0].file.name) : batchZipName;
  outputSize.textContent = `${formatBytes(getOutputTotalBytes(successfulItems))} WebP total • ${formatBytes(zipBlob.size)} ZIP`;
  resultBox.hidden = false;
}

function updateBatchEstimate(items) {
  const outputBytes = getOutputTotalBytes(items);
  estimateBox.hidden = false;
  estimateSize.textContent = formatBytes(outputBytes);
  estimateNote.textContent = getEstimateNote(outputBytes, items.length);
}

function resetApp() {
  resetOutputState();
  resetSelectedFiles();
  setStatus("Choose JPG or PNG images to begin.");
}

function resetAppStateForNewFiles() {
  resetOutputState();
  resetSelectedFiles();
}

function resetOutputState() {
  revokeOutput();
  downloadsEnabled = false;
  hideResult();
  downloadButton.removeAttribute("href");
  downloadButton.download = batchZipName;
  downloadButton.classList.add("disabled");
  downloadButton.setAttribute("aria-disabled", "true");
}

function resetSelectedFiles() {
  clearEstimateTimer();
  hideEstimate();
  revokeAllObjectUrls();
  batchItems = [];
  fileInput.value = "";
  imagePreview.removeAttribute("src");
  fileList.innerHTML = "";
  previewWrap.hidden = true;
  fileInfo.hidden = true;
  batchList.hidden = true;
  convertButton.disabled = true;
  resetButton.disabled = true;
  isConverting = false;
}

function clearEncodedOutputs() {
  downloadsEnabled = false;
  for (const item of batchItems) {
    revokeItemOutput(item);
    item.status = "ready";
    item.error = "";
  }
}

function hideResult() {
  resultBox.hidden = true;
  outputName.textContent = "-";
  outputSize.textContent = "-";
}

function hideEstimate() {
  estimateBox.hidden = true;
  estimateSize.textContent = "Estimating...";
  estimateNote.textContent = "Based on the current quality setting.";
}

function clearEstimateTimer() {
  if (estimateTimer) {
    window.clearTimeout(estimateTimer);
    estimateTimer = null;
  }
}

function revokeOutput() {
  if (outputUrl) {
    URL.revokeObjectURL(outputUrl);
    outputUrl = null;
  }
}

function revokeItemOutput(item) {
  if (item.outputUrl) {
    URL.revokeObjectURL(item.outputUrl);
    item.outputUrl = null;
  }

  item.outputBlob = null;
}

function revokeAllObjectUrls() {
  for (const item of batchItems) {
    if (item.previewUrl) {
      URL.revokeObjectURL(item.previewUrl);
    }

    revokeItemOutput(item);
  }
}

function setStatus(message, isError = false, isSuccess = false) {
  statusMessage.textContent = message;
  statusMessage.classList.toggle("error", isError);
  statusMessage.classList.toggle("success", isSuccess);
}

function getWebpName(name) {
  const baseName = name.replace(/\.[^.]+$/, "");
  return `${baseName || "converted-image"}.webp`;
}

function getDisplayType(file) {
  return file.type === "image/png" ? "PNG" : "JPEG";
}

function getSourceTotalBytes() {
  return batchItems.reduce((total, item) => total + item.file.size, 0);
}

function getOutputTotalBytes(items) {
  return items.reduce((total, item) => total + (item.outputBlob?.size || 0), 0);
}

function getEstimateNote(bytes, count) {
  const fileLabel = `${count} WebP file${count === 1 ? "" : "s"}`;

  if (bytes > 1024 * 1024) {
    return `${fileLabel}. Large for web use. Try a lower quality or resize before uploading.`;
  }

  if (bytes > 500 * 1024) {
    return `${fileLabel}. Reasonable for large images, but may still be heavy on mobile.`;
  }

  return `${fileLabel}. Good candidate size for typical web use.`;
}

function formatBytes(bytes) {
  if (bytes === 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** unitIndex;
  const precision = value >= 10 || unitIndex === 0 ? 0 : 1;

  return `${value.toFixed(precision)} ${units[unitIndex]}`;
}
