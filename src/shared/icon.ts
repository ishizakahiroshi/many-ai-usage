import { ICON_DATA_URL_MAX_LENGTH } from './schema';

/** Square size written into storage for user-uploaded provider icons. */
export const PROVIDER_ICON_SIZE = 64;

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;

/**
 * Resize a user-picked image to a small PNG data URL for chrome.storage.local.
 * Icons are never fetched from provider hosts — only explicit user uploads.
 */
export async function fileToIconDataUrl(file: File, size = PROVIDER_ICON_SIZE): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Choose an image file (PNG, JPEG, WebP, or GIF).');
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error('Image must be 2 MB or smaller.');
  }

  const bitmap = await createImageBitmap(file);
  try {
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Unable to process this image in the browser.');

    // Cover-fit into the square (center crop).
    const scale = Math.max(size / bitmap.width, size / bitmap.height);
    const drawWidth = bitmap.width * scale;
    const drawHeight = bitmap.height * scale;
    context.clearRect(0, 0, size, size);
    context.drawImage(bitmap, (size - drawWidth) / 2, (size - drawHeight) / 2, drawWidth, drawHeight);

    const dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > ICON_DATA_URL_MAX_LENGTH) {
      throw new Error('Image is still too large after resize. Try a simpler image.');
    }
    return dataUrl;
  } finally {
    bitmap.close();
  }
}
