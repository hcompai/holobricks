/** One file to put in a zip archive. */
export interface ZipEntry {
  name: string;
  data: Uint8Array;
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(data: Uint8Array): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

const deflate = async (data: Uint8Array) =>
  new Uint8Array(
    await new Response(
      new Blob([data as BlobPart]).stream().pipeThrough(new CompressionStream("deflate-raw")),
    ).arrayBuffer(),
  );

/** A zip archive of `entries`, each deflated; enough for 3MF packages, without zip64. */
export async function zip(entries: ZipEntry[]): Promise<Blob> {
  const encoder = new TextEncoder();
  const parts: BlobPart[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name);
    const packed = await deflate(entry.data);
    const crc = crc32(entry.data);
    const header = new Uint8Array(30 + name.length);
    const local = new DataView(header.buffer);
    local.setUint32(0, 0x04034b50, true);
    local.setUint16(4, 20, true);
    local.setUint16(8, 8, true);
    // 1980-01-01: archives come out the same for the same files.
    local.setUint16(12, 0x21, true);
    local.setUint32(14, crc, true);
    local.setUint32(18, packed.length, true);
    local.setUint32(22, entry.data.length, true);
    local.setUint16(26, name.length, true);
    header.set(name, 30);

    const record = new Uint8Array(46 + name.length);
    const dir = new DataView(record.buffer);
    dir.setUint32(0, 0x02014b50, true);
    dir.setUint16(4, 20, true);
    dir.setUint16(6, 20, true);
    dir.setUint16(10, 8, true);
    dir.setUint16(14, 0x21, true);
    dir.setUint32(16, crc, true);
    dir.setUint32(20, packed.length, true);
    dir.setUint32(24, entry.data.length, true);
    dir.setUint16(28, name.length, true);
    dir.setUint32(42, offset, true);
    record.set(name, 46);

    parts.push(header as BlobPart, packed as BlobPart);
    central.push(record);
    offset += header.length + packed.length;
  }
  const size = central.reduce((n, r) => n + r.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true);
  end.setUint16(8, entries.length, true);
  end.setUint16(10, entries.length, true);
  end.setUint32(12, size, true);
  end.setUint32(16, offset, true);
  return new Blob([...parts, ...(central as BlobPart[]), end.buffer], { type: "application/zip" });
}
