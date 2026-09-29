import { describe, expect, it } from "vitest";
import { crc32, createZip } from "../src/modules/zip";

describe("zip del paquete del contador", () => {
  it("calcula CRC32 con el vector de referencia", () => {
    expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
  });

  it("arma un ZIP con directorio central y fin de archivo", () => {
    const zip = createZip([
      { name: "a.csv", data: "serie,folio\r\nA,1\r\n" },
      { name: "LEEME.txt", data: "Prefactura / Nota de venta — no es un CFDI" },
    ]);
    expect(zip.readUInt32LE(0)).toBe(0x04034b50);
    const end = zip.length - 22;
    expect(zip.readUInt32LE(end)).toBe(0x06054b50);
    expect(zip.readUInt16LE(end + 10)).toBe(2);
    const centralOffset = zip.readUInt32LE(end + 16);
    expect(zip.readUInt32LE(centralOffset)).toBe(0x02014b50);
  });
});
