import { Money } from "@3dprintmty/domain";
import type { QuoteCosting } from "./quote-costing";

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
  payment?: QuotePdfPayment;
  costing?: QuoteCosting | null;
}

export interface QuotePdfPayment {
  terms: string;
  depositPercent: number;
  deposit: string | null;
  balance: string | null;
  notes: string | null;
  leadTimeDays: number | null;
}

type RGB = readonly [number, number, number];
type Column = { label: string; width: number; align: "left" | "right" };

interface RowOptions {
  fill?: RGB;
  size?: number;
  bold?: boolean | number[];
  colors?: Array<RGB | undefined>;
  span?: boolean;
}

const PAGE_WIDTH = 612;
const PAGE_HEIGHT = 792;
const LEFT = 36;
const RIGHT = 576;
const WIDTH = RIGHT - LEFT;
const TOP = 756;
const BOTTOM = 60;
const PAD = 6;

const INK: RGB = [0.118, 0.161, 0.231];
const MUTED: RGB = [0.392, 0.455, 0.545];
const LINE: RGB = [0.886, 0.91, 0.941];
const HEAD: RGB = [0.945, 0.961, 0.976];
const PANEL: RGB = [0.973, 0.98, 0.988];
const ACCENT: RGB = [0.145, 0.388, 0.922];
const ACCENT_SOFT: RGB = [0.937, 0.965, 1];
const ORANGE: RGB = [1, 0.427, 0.004];
const ORANGE_SOFT: RGB = [1, 0.957, 0.922];
const PINE: RGB = [0.086, 0.639, 0.29];
const DANGER: RGB = [0.863, 0.149, 0.149];

const SUMMARY_COLUMNS: Column[] = [
  { label: "Impresión", width: 176, align: "left" },
  { label: "Piezas", width: 44, align: "right" },
  { label: "Partidas", width: 50, align: "right" },
  { label: "Por pieza", width: 76, align: "right" },
  { label: "Subtotal", width: 66, align: "right" },
  { label: "IVA", width: 58, align: "right" },
  { label: "Total", width: 70, align: "right" },
];

const LINE_COLUMNS: Column[] = [
  { label: "Descripción", width: 168, align: "left" },
  { label: "Cant.", width: 44, align: "right" },
  { label: "UM", width: 42, align: "left" },
  { label: "P. unitario", width: 62, align: "right" },
  { label: "Descuento", width: 54, align: "right" },
  { label: "Importe", width: 58, align: "right" },
  { label: "IVA", width: 50, align: "right" },
  { label: "Total", width: 62, align: "right" },
];

const COST_COLUMNS: Column[] = [
  { label: "Concepto", width: 172, align: "left" },
  { label: "Grupo", width: 62, align: "left" },
  { label: "Cant.", width: 56, align: "right" },
  { label: "Costo unit.", width: 72, align: "right" },
  { label: "Costo", width: 58, align: "right" },
  { label: "Venta", width: 60, align: "right" },
  { label: "Utilidad", width: 60, align: "right" },
];

const GROUP_COLUMNS: Column[] = [
  { label: "Grupo", width: 244, align: "left" },
  { label: "Costo", width: 74, align: "right" },
  { label: "Venta", width: 74, align: "right" },
  { label: "Utilidad", width: 74, align: "right" },
  { label: "Margen", width: 74, align: "right" },
];

/** Cotización o pedido en PDF con el mismo orden que el desglose de la web. */
export function renderQuotePdf(input: QuotePdfInput): Uint8Array {
  const pages: string[][] = [];
  let y = TOP;
  let columns: Column[] | null = null;

  const op = (command: string) => {
    pages.at(-1)?.push(command);
  };
  const fillRect = (x: number, top: number, width: number, height: number, color: RGB) => {
    op(`${rgb(color)} rg ${n(x)} ${n(top - height)} ${n(width)} ${n(height)} re f`);
  };
  const strokeRect = (x: number, top: number, width: number, height: number, color: RGB) => {
    op(`${rgb(color)} RG 0.8 w ${n(x)} ${n(top - height)} ${n(width)} ${n(height)} re S`);
  };
  const hline = (fromX: number, toX: number, at: number, color: RGB = LINE, width = 0.6) => {
    op(`${rgb(color)} RG ${width} w ${n(fromX)} ${n(at)} m ${n(toX)} ${n(at)} l S`);
  };
  const text = (value: string, size: number, x: number, baseline: number, options?: { bold?: boolean; color?: RGB }) => {
    const font = options?.bold ? "F2" : "F1";
    op(`BT /${font} ${size} Tf ${rgb(options?.color ?? INK)} rg ${n(x)} ${n(baseline)} Td (${escapePdf(value)}) Tj ET`);
  };
  const textRight = (value: string, size: number, right: number, baseline: number, options?: { bold?: boolean; color?: RGB }) => {
    text(value, size, right - textWidth(value, size, options?.bold), baseline, options);
  };

  const newPage = () => {
    pages.push([]);
    fillRect(0, PAGE_HEIGHT, PAGE_WIDTH, 6, input.costing ? ORANGE : ACCENT);
    y = pages.length === 1 ? TOP : TOP + 6;
  };

  const columnHeader = () => {
    if (!columns) return;
    const height = 20;
    fillRect(LEFT, y, WIDTH, height, HEAD);
    let x = LEFT;
    for (const column of columns) {
      const label = column.label.toLocaleUpperCase("es-MX");
      if (column.align === "right") textRight(label, 7, x + column.width - PAD, y - 13, { bold: true, color: MUTED });
      else text(label, 7, x + PAD, y - 13, { bold: true, color: MUTED });
      x += column.width;
    }
    hline(LEFT, RIGHT, y - height);
    y -= height;
  };

  const ensure = (height: number) => {
    if (y - height >= BOTTOM) return;
    newPage();
    columnHeader();
  };

  const row = (values: string[], options: RowOptions = {}) => {
    const table = columns ?? LINE_COLUMNS;
    const size = options.size ?? 8.5;
    const lead = size + 3;
    const isBold = (index: number) => (Array.isArray(options.bold) ? options.bold.includes(index) : Boolean(options.bold));
    const wrapped = values.map((value, index) => {
      const column = table[index];
      if (!column) return [];
      if (options.span) return index === 0 ? wrapToWidth(value, size, WIDTH - PAD * 2, isBold(0)) : [];
      return wrapToWidth(value, size, column.width - PAD * 2, isBold(index));
    });
    const lineCount = Math.max(1, ...wrapped.map((lines) => lines.length));
    const height = 11 + lineCount * lead;
    ensure(height);
    if (options.fill) fillRect(LEFT, y, WIDTH, height, options.fill);
    let x = LEFT;
    wrapped.forEach((lines, index) => {
      const column = table[index];
      if (!column) return;
      const style = { bold: isBold(index), color: options.colors?.[index] ?? INK };
      lines.forEach((line, lineIndex) => {
        const baseline = y - 6 - size * 0.9 - lineIndex * lead;
        if (column.align === "right" && !options.span) textRight(line, size, x + column.width - PAD, baseline, style);
        else text(line, size, x + PAD, baseline, style);
      });
      x += column.width;
    });
    hline(LEFT, RIGHT, y - height);
    y -= height;
  };

  const sectionTitle = (title: string, note?: string) => {
    ensure(34);
    y -= 8;
    text(title, 11, LEFT, y - 11, { bold: true });
    if (note) text(note, 8, LEFT + textWidth(title, 11, true) + 8, y - 11, { color: MUTED });
    y -= 20;
  };

  const band = (title: string, detail: string, accent: RGB, soft: RGB) => {
    ensure(22 + 20 + 22);
    const height = 22;
    fillRect(LEFT, y, WIDTH, height, soft);
    fillRect(LEFT, y, 3, height, accent);
    text(fit(title, 9.5, 300, true), 9.5, LEFT + 10, y - 14.5, { bold: true });
    textRight(detail, 8, RIGHT - PAD, y - 14.5, { color: MUTED });
    y -= height;
  };

  newPage();

  // Encabezado
  const title = input.title ?? "COTIZACIÓN";
  text(fit(input.issuer, 16, 300, true), 16, LEFT, y - 14, { bold: true });
  textRight(title, 18, RIGHT, y - 16, { bold: true, color: input.costing ? ORANGE : ACCENT });
  text(`RFC ${input.issuerRfc} · Régimen ${input.issuerRegime} · C.P. ${input.issuerPostalCode}`, 8.5, LEFT, y - 30, { color: MUTED });
  textRight(input.folio, 11, RIGHT, y - 33, { bold: true });
  textRight(`Fecha ${input.issuedAt}`, 8.5, RIGHT, y - 46, { color: MUTED });
  textRight(`${input.dateLabel ?? "Vigente hasta"} ${input.validUntil}`, 8.5, RIGHT, y - 58, { color: MUTED });
  y -= 72;

  // Cliente y condiciones
  const panelWidth = (WIDTH - 12) / 2;
  const panelHeight = 58;
  const kind = input.kindLabel ?? (input.mode === "prints" ? "Impresiones" : "Productos");
  const panels: Array<[string, string, string]> = [
    ["CLIENTE", input.customerName, input.customerRfc ? `RFC ${input.customerRfc}` : "Sin RFC"],
    ["CONDICIONES", `${input.currency} · ${input.paymentTerms}`, `${vatLabel(input.vatRate)} · ${kind}`],
  ];
  panels.forEach(([label, main, detail], index) => {
    const x = LEFT + index * (panelWidth + 12);
    fillRect(x, y, panelWidth, panelHeight, PANEL);
    strokeRect(x, y, panelWidth, panelHeight, LINE);
    text(label, 7, x + 12, y - 15, { bold: true, color: MUTED });
    text(fit(main, 11, panelWidth - 24, true), 11, x + 12, y - 31, { bold: true });
    text(fit(detail, 9, panelWidth - 24), 9, x + 12, y - 45, { color: MUTED });
  });
  y -= panelHeight + 10;

  // Partidas
  if (input.mode === "prints") {
    sectionTitle("Resumen", `${input.prints.length} impresi${input.prints.length === 1 ? "ón" : "ones"}`);
    columns = SUMMARY_COLUMNS;
    columnHeader();
    for (const print of input.prints) {
      row(
        [print.name, trimQty(print.quantity), String(print.lines.length), money(print.unitTotal), money(print.subtotal), money(print.vat), money(print.total)],
        { bold: [0, 6] },
      );
    }
    columns = null;

    sectionTitle("Detalle por impresión");
    for (const print of input.prints) {
      band(print.name, `${trimQty(print.quantity)} piezas · importe por pieza ${money(print.unitTotal)}`, ACCENT, ACCENT_SOFT);
      columns = LINE_COLUMNS;
      columnHeader();
      for (const line of print.lines) lineRow(line);
      row(["Subtotal de la impresión", "", "", "", money(print.discount), money(print.subtotal), money(print.vat), money(print.total)], {
        fill: PANEL,
        bold: true,
      });
      columns = null;
      y -= 12;
    }
  } else {
    sectionTitle("Partidas");
    columns = LINE_COLUMNS;
    columnHeader();
    for (const line of input.lines) lineRow(line);
    columns = null;
  }

  function lineRow(line: QuotePdfLine) {
    const description = line.terms ? `${line.description} · ${line.terms}` : line.description;
    row(
      [description, trimQty(line.quantity), line.uom, money(line.unitPrice), money(line.discount), money(line.net), money(line.vat), money(line.total)],
      { bold: [7] },
    );
  }

  // Condiciones de pago y totales
  y -= 12;
  const totalsWidth = 220;
  const totalsX = RIGHT - totalsWidth;
  const totalsHeight = 92;
  const termsWidth = WIDTH - totalsWidth - 12;
  const termRows = input.payment ? paymentRows(input.payment, input.total) : [];
  const noteLines = input.payment?.notes ? wrapToWidth(input.payment.notes, 8, termsWidth - 24) : [];
  const termsHeight = termRows.length ? 30 + termRows.length * 14 + (noteLines.length ? 4 + noteLines.length * 11 : 0) + 6 : 0;
  ensure(Math.max(totalsHeight, termsHeight));
  if (termRows.length) {
    fillRect(LEFT, y, termsWidth, termsHeight, PANEL);
    strokeRect(LEFT, y, termsWidth, termsHeight, LINE);
    text("CONDICIONES DE PAGO", 7, LEFT + 12, y - 15, { bold: true, color: MUTED });
    termRows.forEach(([label, value], index) => {
      const baseline = y - 32 - index * 14;
      text(label, 8.5, LEFT + 12, baseline, { color: MUTED });
      text(fit(value, 8.5, termsWidth - 112, true), 8.5, LEFT + 100, baseline, { bold: true });
    });
    noteLines.forEach((line, index) => {
      text(line, 8, LEFT + 12, y - 32 - termRows.length * 14 - 2 - index * 11, { color: MUTED });
    });
  }
  fillRect(totalsX, y, totalsWidth, totalsHeight, PANEL);
  strokeRect(totalsX, y, totalsWidth, totalsHeight, LINE);
  const totalRows: Array<[string, string]> = [
    ["Subtotal", money(input.subtotal)],
    ["Descuento", money(input.discount)],
    ["IVA", money(input.vat)],
  ];
  totalRows.forEach(([label, amount], index) => {
    const baseline = y - 18 - index * 15;
    text(label, 9, totalsX + 14, baseline, { color: MUTED });
    textRight(amount, 9, RIGHT - 14, baseline);
  });
  hline(totalsX + 14, RIGHT - 14, y - 60);
  text(`Total ${input.currency}`, 11, totalsX + 14, y - 79, { bold: true });
  textRight(money(input.total), 14, RIGHT - 14, y - 80, { bold: true, color: input.costing ? ORANGE : ACCENT });
  y -= Math.max(totalsHeight, termsHeight);

  if (input.serviceTerms) {
    sectionTitle("Términos");
    for (const part of wrapToWidth(input.serviceTerms, 8.5, WIDTH)) {
      ensure(12);
      text(part, 8.5, LEFT, y - 9, { color: MUTED });
      y -= 12;
    }
  }

  const costing = input.costing;
  if (costing) {
    y -= 18;
    ensure(130);
    fillRect(LEFT, y, 3, 22, ORANGE);
    text("Costo y utilidad", 13, LEFT + 10, y - 15, { bold: true });
    text("Uso interno. Costos vigentes del catálogo; la venta es el importe sin IVA.", 8, LEFT + 10 + textWidth("Costo y utilidad", 13, true) + 10, y - 15, {
      color: MUTED,
    });
    y -= 32;

    const profitColor = tone(costing.profit);
    const kpis: Array<[string, string, RGB]> = [
      ["COSTO PARA SURTIR", money(costing.cost), INK],
      ["VENTA SIN IVA", money(costing.revenue), INK],
      ["UTILIDAD", money(costing.profit), profitColor ?? INK],
      ["MARGEN", costing.marginPct === null ? "-" : `${costing.marginPct}%`, profitColor ?? INK],
    ];
    const kpiWidth = (WIDTH - 24) / 4;
    kpis.forEach(([label, value, color], index) => {
      const x = LEFT + index * (kpiWidth + 8);
      fillRect(x, y, kpiWidth, 46, PANEL);
      strokeRect(x, y, kpiWidth, 46, LINE);
      text(label, 7, x + 10, y - 15, { bold: true, color: MUTED });
      text(value, 13, x + 10, y - 34, { bold: true, color });
    });
    y -= 56;

    if (costing.missing > 0) {
      const warning = `${costing.missing} partida${costing.missing === 1 ? "" : "s"} sin costo en el catálogo. La utilidad real es menor.`;
      fillRect(LEFT, y, WIDTH, 20, ORANGE_SOFT);
      text(warning, 8.5, LEFT + 10, y - 13.5, { color: ORANGE, bold: true });
      y -= 28;
    }

    const costRow = (line: QuoteCosting["lines"][number]) => {
      row(
        [
          line.description,
          line.group,
          `${trimQty(line.quantity)} ${line.uom}`,
          line.unitCost ? `${money(line.unitCost)}/${line.unitBasis}` : "Sin costo",
          money(line.cost),
          money(line.revenue),
          money(line.profit),
        ],
        { colors: [undefined, MUTED, undefined, line.unitCost ? undefined : ORANGE, undefined, undefined, tone(line.profit)], bold: [6] },
      );
    };

    if (input.mode === "prints") {
      for (const print of costing.prints) {
        band(print.label, `${trimQty(print.quantity)} piezas · costo por pieza ${money(print.unitCost)}`, ORANGE, ORANGE_SOFT);
        columns = COST_COLUMNS;
        columnHeader();
        costing.lines.filter((line) => line.printId === print.id).forEach(costRow);
        row(["Subtotal de la impresión", "", "", "", money(print.cost), money(print.revenue), money(print.profit)], {
          fill: PANEL,
          bold: true,
          colors: [undefined, undefined, undefined, undefined, undefined, undefined, tone(print.profit)],
        });
        columns = null;
        y -= 12;
      }
      const loose = costing.lines.filter((line) => !line.printId);
      if (loose.length) {
        columns = COST_COLUMNS;
        columnHeader();
        loose.forEach(costRow);
        columns = null;
        y -= 12;
      }
    } else if (costing.lines.length > 0) {
      columns = COST_COLUMNS;
      columnHeader();
      costing.lines.forEach(costRow);
      columns = null;
      y -= 12;
    }

    sectionTitle("Por grupo");
    columns = GROUP_COLUMNS;
    columnHeader();
    for (const group of costing.groups) {
      const revenue = Number(group.revenue);
      const margin = revenue > 0 ? `${((Number(group.profit) / revenue) * 100).toFixed(1)}%` : "-";
      row([group.label, money(group.cost), money(group.revenue), money(group.profit), margin], {
        bold: [0, 3],
        colors: [undefined, undefined, undefined, tone(group.profit), tone(group.profit)],
      });
    }
    columns = null;
  }

  const note = costing ? "Uso interno del taller. No entregar al cliente." : "Documento comercial. No es un CFDI.";
  pages.forEach((page, index) => {
    const footer = `${input.folio} · Página ${index + 1} de ${pages.length}`;
    page.push(`${rgb(LINE)} RG 0.6 w ${n(LEFT)} 42 m ${n(RIGHT)} 42 l S`);
    page.push(`BT /F1 7.5 Tf ${rgb(MUTED)} rg ${n(LEFT)} 30 Td (${escapePdf(note)}) Tj ET`);
    page.push(`BT /F1 7.5 Tf ${rgb(MUTED)} rg ${n(RIGHT - textWidth(footer, 7.5))} 30 Td (${escapePdf(footer)}) Tj ET`);
  });

  return buildPdf(pages);
}

function buildPdf(pages: string[][]): Uint8Array {
  const regular = 3;
  const bold = 4;
  const firstPage = 5;
  const objects: string[] = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    `<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, index) => `${firstPage + index * 2} 0 R`).join(" ")}] >>`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>",
  ];
  pages.forEach((page, index) => {
    const stream = page.join("\n");
    const contents = firstPage + index * 2 + 1;
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Contents ${contents} 0 R /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> >>`,
    );
    objects.push(`<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}\nendstream`);
  });

  let pdf = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, "latin1"));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(pdf, "latin1");
  pdf += `xref\n0 ${objects.length + 1}\n`;
  pdf += "0000000000 65535 f \n";
  for (const offset of offsets) pdf += `${offset.toString().padStart(10, "0")} 00000 n \n`;
  pdf += `trailer << /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, "latin1");
}

/** Anchos de Helvetica en milésimas de punto; las letras acentuadas usan la letra base. */
const CHAR_WIDTH: Record<string, number> = {
  " ": 278, ".": 278, ",": 278, ":": 278, ";": 278, "-": 333, "/": 278, "$": 556, "%": 889, "(": 333, ")": 333,
  "·": 278, "#": 556, "&": 667, "+": 584, "=": 584, "'": 191, '"': 355, "?": 556, "!": 278, "@": 1015, "_": 556,
  "0": 556, "1": 556, "2": 556, "3": 556, "4": 556, "5": 556, "6": 556, "7": 556, "8": 556, "9": 556,
  A: 667, B: 667, C: 722, D: 722, E: 667, F: 611, G: 778, H: 722, I: 278, J: 500, K: 667, L: 556, M: 833,
  N: 722, O: 778, P: 667, Q: 778, R: 722, S: 667, T: 611, U: 722, V: 667, W: 944, X: 667, Y: 667, Z: 611,
  a: 556, b: 556, c: 500, d: 556, e: 556, f: 278, g: 556, h: 556, i: 222, j: 222, k: 500, l: 222, m: 833,
  n: 556, o: 556, p: 556, q: 556, r: 333, s: 500, t: 278, u: 556, v: 500, w: 722, x: 500, y: 500, z: 500,
};

function charWidth(char: string): number {
  return CHAR_WIDTH[char] ?? CHAR_WIDTH[char.normalize("NFD")[0] ?? ""] ?? 556;
}

function textWidth(value: string, size: number, bold = false): number {
  let units = 0;
  for (const char of value) units += charWidth(char);
  return ((units * (bold ? 1.06 : 1)) / 1000) * size;
}

function wrapToWidth(value: string, size: number, max: number, bold = false): string[] {
  const words = value.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const next = current ? `${current} ${word}` : word;
    if (textWidth(next, size, bold) > max && current) {
      lines.push(current);
      current = word;
    } else {
      current = next;
    }
  }
  if (current) lines.push(current);
  return lines.length ? lines : [""];
}

function fit(value: string, size: number, max: number, bold = false): string {
  if (textWidth(value, size, bold) <= max) return value;
  let cut = value;
  while (cut.length > 1 && textWidth(`${cut}...`, size, bold) > max) cut = cut.slice(0, -1);
  return `${cut.trimEnd()}...`;
}

function paymentRows(payment: QuotePdfPayment, total: string | null): Array<[string, string]> {
  const credit = payment.terms === "net_15" ? 15 : payment.terms === "net_30" ? 30 : 0;
  const when = credit ? `a ${credit} días de crédito` : "contra entrega";
  const rows: Array<[string, string]> = [["Forma de pago", credit ? `Crédito ${credit} días` : "Contado"]];
  if (payment.depositPercent >= 100) {
    rows.push(["Anticipo 100%", `${money(payment.deposit)} al aceptar`]);
  } else if (payment.depositPercent > 0) {
    rows.push([`Anticipo ${payment.depositPercent}%`, `${money(payment.deposit)} al aceptar`]);
    rows.push(["Saldo", `${money(payment.balance)} ${when}`]);
  } else {
    rows.push(["Pago", `${money(total)} ${when}`]);
  }
  if (payment.leadTimeDays) {
    const days = payment.leadTimeDays === 1 ? "1 día hábil" : `${payment.leadTimeDays} días hábiles`;
    rows.push(["Entrega", `${days} a partir ${payment.depositPercent > 0 ? "del anticipo" : "de la aceptación"}`]);
  }
  return rows;
}

function tone(value: string | null): RGB | undefined {
  if (value === null) return undefined;
  const amount = Number(value);
  if (amount > 0) return PINE;
  if (amount < 0) return DANGER;
  return undefined;
}

function rgb(color: RGB): string {
  return color.map((part) => part.toFixed(3)).join(" ");
}

function n(value: number): string {
  return value.toFixed(2);
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

/** Escapa la sintaxis de PDF y lleva la tipografía de Unicode a WinAnsi. */
function escapePdf(value: string): string {
  return value
    .replace(/[\u2014]/g, "\x97")
    .replace(/[\u2013]/g, "\x96")
    .replace(/[\u2018\u2019]/g, "\x92")
    .replace(/[\u201C]/g, "\x93")
    .replace(/[\u201D]/g, "\x94")
    .replace(/[\u2022]/g, "\x95")
    .replace(/[\u20AC]/g, "\x80")
    .replace(/[()\\]/g, (char) => `\\${char}`);
}
