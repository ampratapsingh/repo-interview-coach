import { LIMITS } from "./config";

export type ZipInspection = { entries: number; uncompressedBytes: number };

export function inspectZip(bytes: Uint8Array): ZipInspection {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const minimum = Math.max(0, bytes.length - 65_557);
  let end = -1;
  for (let offset = bytes.length - 22; offset >= minimum; offset--) {
    if (view.getUint32(offset, true) === 0x06054b50) { end = offset; break; }
  }
  if (end < 0) throw new Error("The downloaded file is not a valid ZIP archive.");
  const entries = view.getUint16(end + 10, true);
  const directoryOffset = view.getUint32(end + 16, true);
  if (entries > LIMITS.extractedFiles) throw new Error(`Repository contains more than ${LIMITS.extractedFiles.toLocaleString()} files.`);
  let offset = directoryOffset;
  let uncompressedBytes = 0;
  for (let index = 0; index < entries; index++) {
    if (offset + 46 > bytes.length || view.getUint32(offset, true) !== 0x02014b50) throw new Error("The ZIP central directory is malformed.");
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const unixMode = view.getUint32(offset + 38, true) >>> 16;
    if ((unixMode & 0o170000) === 0o120000) throw new Error("Repository archives containing symbolic links are not supported.");
    uncompressedBytes += size;
    if (uncompressedBytes > LIMITS.extractedArchiveBytes) throw new Error("Repository expands beyond the 80 MB safety limit.");
    offset += 46 + nameLength + extraLength + commentLength;
  }
  return { entries, uncompressedBytes };
}

