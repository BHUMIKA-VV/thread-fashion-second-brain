import { crc32, deflateSync } from "node:zlib";

type Rgb = [number, number, number];

/**
 * Encode an RGB PNG made of full-width horizontal bands, in memory. No external assets needed.
 */
export function bandsPng(width: number, bands: { rows: number; rgb: Rgb }[]): Buffer {
  const rows: Buffer[] = [];
  for (const band of bands) {
    const row = Buffer.alloc(1 + width * 3); // filter byte 0, then pixels
    for (let x = 0; x < width; x++) row.set(band.rgb, 1 + x * 3);
    for (let i = 0; i < band.rows; i++) rows.push(row);
  }
  const height = bands.reduce((sum, band) => sum + band.rows, 0);

  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };

  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8); // 8-bit depth, RGB, default compression/filter/interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

/** A solid-colour PNG. Each call with a fresh colour gives a unique file (no duplicate 409s). */
export function solidPng(width: number, height: number, rgb: Rgb): Buffer {
  return bandsPng(width, [{ rows: height, rgb }]);
}

export function randomColour(): Rgb {
  return [0, 0, 0].map(() => Math.floor(Math.random() * 256)) as Rgb;
}
