// "What have you already pasted?" A ChatGPT or Claude export, read in this
// browser tab. The file is never uploaded: it is unzipped and screened here.
//
// scanHistory and parseExport are Deliverd Screen's own (src/history.ts in
// @deliverd/screen); they need no file system, so they run in a browser too.
import { parseExport, scanHistory } from "../node_modules/@deliverd/screen/dist/history.js";

export { scanHistory };

/** The conversations in an export: its .zip as downloaded, or its conversations.json. */
export async function readExportFile(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  const json = isZip ? await fileInZip(bytes, "conversations.json") : new TextDecoder().decode(bytes);
  if (json === null) throw new Error("That zip has no conversations.json in it. Is it a ChatGPT or Claude export?");
  let parsed;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new Error("Screener couldn't read that as an export. Drop the .zip you downloaded, or the conversations.json inside it.");
  }
  const conversations = parseExport(parsed);
  if (!conversations.length) throw new Error("Screener found no conversations in that file.");
  return conversations;
}

/** One file from a zip, by name at any depth, unzipped with the browser's own DecompressionStream. */
export async function fileInZip(zip, name) {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end-of-central-directory record is in the last 64 KB.
  let eocd = -1;
  for (let i = zip.length - 22; i >= Math.max(0, zip.length - 65_557); i--) {
    if (view.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("That doesn't look like a complete zip file.");
  const count = view.getUint16(eocd + 10, true);
  let at = view.getUint32(eocd + 16, true);
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== 0x02014b50) break;
    const method = view.getUint16(at + 10, true);
    const compressed = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const local = view.getUint32(at + 42, true);
    const entry = decoder.decode(zip.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (entry !== name && !entry.endsWith(`/${name}`)) continue;
    const start = local + 30 + view.getUint16(local + 26, true) + view.getUint16(local + 28, true);
    const data = zip.subarray(start, start + compressed);
    if (method === 0) return decoder.decode(data);
    if (method !== 8) throw new Error("That zip uses a kind of compression Screener can't open.");
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return await new Response(stream).text();
  }
  return null;
}
