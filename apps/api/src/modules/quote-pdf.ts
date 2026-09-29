import { Money } from "@3dprintmty/domain";

export interface QuotePdfLine {
  description: string;
  terms: string | null;
  uom: string;
  quantity: string;
  unitPrice: string | null;
  discount: string | null;
  net: string | null;
  vat: string | null;
  total: string | null;
}

export interface QuotePdfPrint {
  name: string;
  quantity: string;
  unitTotal: string | null;
  subtotal: string | null;
  discount: string | null;
  vat: string | null;
  total: string | null;
  lines: QuotePdfLine[];
}

export interface QuotePdfInput {
  folio: string;
  issuedAt: string;
  customerName: string;
  customerRfc: string | null;
  paymentTerms: string;
  validUntil: string;
  mode: "prints" | "products";
  serviceTerms: string | null;
  subtotal: string | null;
  discount: string | null;
  vat: string | null;
  vatRate: string;
  total: string | null;
  currency: string;
  title?: string;
  dateLabel?: string;
  kindLabel?: string;
  issuer: string;
  issuerRfc: string;
  issuerRegime: string;
  issuerPostalCode: string;
  prints: QuotePdfPrint[];
  lines: QuotePdfLine[];
}

const LEFT = 36;
const RIGHT = 576;
const WIDTH = RIGHT - LEFT;
const BOTTOM = 48;

const COLUMNS: Array<{ label: string; width: number; align: "left" | "right" }> = [
  { label: "Descripción", width: 156, align: "left" },
  { label: "Cant.", width: 36, align: "right" },
  { label: "UM", width: 44, align: "left" },
  { label: "P. unitario", width: 64, align: "right" },
  { label: "Descuento", width: 58, align: "right" },
  { label: "Importe", width: 58, align: "right" },
  { label: "IVA", width: 52, align: "right" },
  { label: "Total", width: 72, align: "right" },
];

/** Cotización en PDF, con tabla de partidas y acentos del español. */
export function renderQuotePdf(input: QuotePdfInput): Uint8Array {
  const pages: string[][] = [[]];
  let y = 748;

  const op = (command: string) => {
    pages.at(-1)?.push(command);
  };
  const textAt = (value: string, size: number, x: number, baseline: number) => {
    op(`BT /F1 ${size} Tf ${x.toFixed(2)} ${baseline.toFixed(2)} Td (${escapePdf(value)}) Tj ET`);
  };

  const rule = (fromX: number, toX: number, at: number) => {
    op(`0.75 G 0.6 w ${fromX.toFixed(2)} ${at.toFixed(2)} m ${toX.toFixed(2)} ${at.toFixed(2)} l S 0 G`);
  };

  const ensure = (height: number) => {
    if (y - height >= BOTTOM) return;
    pages.push([]);
    y = 748;
    columnHeader();
  };

  const columnHeader = () => {
    const height = 18;
    op(`0.90 g ${LEFT} ${(y - height).toFixed(2)} ${WIDTH} ${height} re f 0 g`);
    let x = LEFT;
    for (const column of COLUMNS) {
      const label = column.label;
      const tx = column.align === "right" ? x + column.width - 4 - textWidth(label, 8) : x + 4;
      textAt(label, 8, tx, y - 13);
      x += column.width;
    }
    op(`0.55 G 0.8 w ${LEFT} ${y.toFixed(2)} ${WIDTH} ${height} re S 0 G`);
    y -= height;
  };

  const cells = (values: string[], options?: { fill?: number; size?: number; spanFirst?: boolean }) => {
    const size = options?.size ?? 8;
    const wrapped = values.map((value, index) => {
      const column = COLUMNS[index];
      if (!column) return [value];
      if (options?.spanFirst && index > 0) return [""];
      return wrapToWidth(value, size, column.width - 8);
    });
    const lineCount = Math.max(1, ...wrapped.map((lines) => lines.length));
    const height = 8 + lineCount * (size + 2);
    ensure(height);
    if (options?.fill !== undefined) {
      op(`${options.fill} g ${LEFT} ${(y - height).toFixed(2)} ${WIDTH} ${height} re f 0 g`);
    }
    let x = LEFT;
    wrapped.forEach((lines, index) => {
      const column = COLUMNS[index];
      if (!column) return;
      lines.forEach((line, lineIndex) => {
        const tx = column.align === "right" ? x + column.width - 4 - textWidth(line, size) : x + 4;
        textAt(line, size, tx, y - 11 - lineIndex * (size + 2));
      });
      if (!options?.spanFirst || index === 0) {
        op(`0.82 G 0.4 w ${x.toFixed(2)} ${(y - height).toFixed(2)} m ${x.toFixed(2)} ${y.toFixed(2)} l S 0 G`);
      }
      x += column.width;
    });
    op(`0.82 G 0.4 w ${RIGHT.toFixed(2)} ${(y - height).toFixed(2)} m ${RIGHT.toFixed(2)} ${y.toFixed(2)} l S 0 G`);
    rule(LEFT, RIGHT, y - height);
    y -= height;
  };

  textAt(input.issuer, 14, LEFT, y);
  const title = input.title ?? "COTIZACIÓN";
  textAt(title, 14, RIGHT - textWidth(title, 14), y);
  y -= 18;
  textAt(`RFC ${input.issuerRfc}`, 9, LEFT, y);
  textAt(input.folio, 11, RIGHT - textWidth(input.folio, 11), y);
  y -= 13;
  textAt(`Régimen ${input.issuerRegime} · C.P. ${input.issuerPostalCode}`, 9, LEFT, y);
  textAt(`Fecha ${input.issuedAt}`, 9, RIGHT - textWidth(`Fecha ${input.issuedAt}`, 9), y);
  y -= 12;
  const dateLine = `${input.dateLabel ?? "Vigente hasta"} ${input.validUntil}`;
  textAt(dateLine, 9, RIGHT - textWidth(dateLine, 9), y);
  y -= 16;
  rule(LEFT, RIGHT, y);
  y -= 16;

  textAt("Cliente", 8, LEFT, y);
  textAt("Condiciones", 8, 320, y);
  y -= 12;
  textAt(input.customerName, 11, LEFT, y);
  textAt(`${input.currency} · ${input.paymentTerms}`, 9, 320, y);
  y -= 13;
  textAt(input.customerRfc ? `RFC ${input.customerRfc}` : "Sin RFC", 9, LEFT, y);
  const kind = input.kindLabel ?? (input.mode === "prints" ? "Impresiones" : "Productos");
  textAt(`${vatLabel(input.vatRate)} · ${kind}`, 9, 320, y);
  y -= 18;

  columnHeader();
  if (input.mode === "prints") {
    for (const print of input.prints) {
      cells([`${print.name} · ${trimQty(print.quantity)} piezas`, "", "", "", "", "", "", ""], { fill: 0.94, size: 9, spanFirst: true });
      for (const line of print.lines) {
        const description = line.terms ? `${line.description} · ${line.terms}` : line.description;
        cells([
          description,
          trimQty(line.quantity),
          line.uom,
          money(line.unitPrice),
          money(line.discount),
          money(line.net),
          money(line.vat),
          money(line.total),
        ]);
      }
      cells(
        [
          `Importe por pieza ${money(print.unitTotal)}`,
          "",
          "",
          "",
          money(print.discount),
          money(print.subtotal),
          money(print.vat),
          money(print.total),
        ],
        { fill: 0.96 },
      );
    }
  } else {
    for (const line of input.lines) {
      const description = line.terms ? `${line.description} · ${line.terms}` : line.description;
      cells([
        description,
        trimQty(line.quantity),
        line.uom,
        money(line.unitPrice),
        money(line.discount),
        money(line.net),
        money(line.vat),
        money(line.total),
      ]);
    }
  }

  y -= 14;
  const totals: Array<[string, string, boolean]> = [
    ["Subtotal", money(input.subtotal), false],
    ["Descuento", money(input.discount), false],
    ["IVA", money(input.vat), false],
    [`Total ${input.currency}`, money(input.total), true],
  ];
  for (const [label, amount, strong] of totals) {
    ensure(16);
    const size = strong ? 11 : 9;
    textAt(label, size, 400, y);
    textAt(amount, size, RIGHT - textWidth(amount, size), y);
    y -= strong ? 16 : 13;
  }

  if (input.serviceTerms) {
    y -= 8;
    ensure(16);
    textAt("Términos", 9, LEFT, y);
    y -= 12;
    for (const part of wrap(input.serviceTerms, 95)) {
      ensure(12);
      textAt(part, 9, LEFT, y);
      y -= 12;
    }
  }
  y -= 8;
  ensure(12);
  textAt("Documento comercial. No es un CFDI.", 8, LEFT, y);

  return buildPdf(pages);
}

function buildPdf(pages: string[][]): Uint8Array {
  const objects: string[] = [];
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  const pageObjectNumbers: number[] = [];
  for (let index = 0; index < pages.length; index += 1) {
    pageObjectNumbers.push(3 + index * 2);
  }
  objects.push(`<< /Type /Pages /Count ${pages.length} /Kids [${pageObjectNumbers.map((n) => `${n} 0 R`).join(" ")}] >>`);
  for (let index = 0; index < pages.length; index += 1) {
    const stream = (pages[index] ?? []).join("\n");
    const pageNumber = 3 + index * 2;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents ${pageNumber + 1} 0 R /Resources << /Font << /F1 5 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  }
  const fontObject = 3 + pages.length * 2;
  objects.push(`<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>`);
  for (let index = 0; index < pages.length; index += 1) {
    const pageIndex = 2 + index * 2;
    const pageObject = objects[pageIndex];
    if (pageObject) objects[pageIndex] = pageObject.replace("/F1 5 0 R", `/F1 ${fontObject} 0 R`);
  }

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets.slice(1)) pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

const CHAR_WIDTH: Record<string, number> = {
  " ": 278,
  ".": 278,
  ",": 278,
  ":": 278,
  ";": 278,
  "-": 333,
  "/": 278,
  $: 556,
  "0": 556,
  "1": 556,
  "2": 556,
  "3": 556,
  "4": 556,
  "5": 556,
  "6": 556,
  "7": 556,
  "8": 556,
  "9": 556,
};

function textWidth(value: string, size: number): number {
  let units = 0;
  for (const char of value) units += CHAR_WIDTH[char] ?? 520;
  return (units / 1000) * size;
}

function wrapToWidth(value: string, size: number, max: number): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (textWidth(next, size) > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function vatLabel(rate: string): string {
  const pct = Math.round(Number(rate) * 100);
  return Number.isFinite(pct) ? `IVA ${pct}%` : "IVA";
}

function money(value: string | null): string {
  if (!value) return "-";
  return Money.fromMajor(value).format("es-MX").replace(/[\u202F\u00A0]/g, " ");
}

function trimQty(value: string): string {
  return value.replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

function wrap(value: string, width: number): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (next.length > width && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function escapePdf(value: string): string {
  return value.replace(/[()\\]/g, (char) => `\\${char}`);
}
