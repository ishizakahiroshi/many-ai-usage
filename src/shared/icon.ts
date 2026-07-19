import { ICON_DATA_URL_MAX_LENGTH } from './schema';

/** Square size written into storage for user-uploaded provider icons. */
export const PROVIDER_ICON_SIZE = 64;

const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
/** Sample letter badges on GitHub raw stay tiny; hard-cap before base64. */
export const SAMPLE_ICON_MAX_BYTES = 64 * 1024;

/** Only this host prefix may supply starter sample icons (same as host_permissions). */
export const SAMPLE_ICON_URL_PREFIX = 'https://raw.githubusercontent.com/ishizakahiroshi/';

/**
 * Starter sample icons must be GitHub raw under ishizakahiroshi/* and a static image path.
 * Rejects arbitrary hosts (no open redirect into storage).
 */
export function isAllowedSampleIconUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'https:') return false;
    if (parsed.hostname !== 'raw.githubusercontent.com') return false;
    if (!parsed.pathname.startsWith('/ishizakahiroshi/')) return false;
    if (parsed.username || parsed.password) return false;
    return /\.(svg|png|jpe?g|webp|gif)$/i.test(parsed.pathname);
  } catch {
    return false;
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

function mimeFromSampleIconUrl(url: string): string {
  const lower = url.toLowerCase();
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  if (lower.endsWith('.png')) return 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  return 'application/octet-stream';
}

/**
 * Fetch a sample icon from the allowed GitHub raw host once and return a data URL
 * for local chrome.storage (no re-fetch on popup open).
 */
export async function fetchSampleIconDataUrl(url: string): Promise<string> {
  if (!isAllowedSampleIconUrl(url)) {
    throw new Error('Sample icon URL is not allowed');
  }
  const response = await fetch(url, { cache: 'no-store', credentials: 'omit' });
  if (!response.ok) throw new Error(`Sample icon request failed (${response.status})`);
  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) throw new Error('Sample icon is empty');
  if (buffer.byteLength > SAMPLE_ICON_MAX_BYTES) {
    throw new Error(`Sample icon is too large (${buffer.byteLength} bytes; max ${SAMPLE_ICON_MAX_BYTES})`);
  }
  const mime = mimeFromSampleIconUrl(url);
  if (mime === 'application/octet-stream') throw new Error('Sample icon type is not supported');
  const dataUrl = `data:${mime};base64,${bytesToBase64(new Uint8Array(buffer))}`;
  if (dataUrl.length > ICON_DATA_URL_MAX_LENGTH) {
    throw new Error('Sample icon data URL exceeds storage limit');
  }
  return dataUrl;
}

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
