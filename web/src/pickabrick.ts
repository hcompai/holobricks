import { useEffect, useState } from "react";
import { loadAsset } from "./loadAsset";
import type { Piece } from "./model";

/** LEGO Pick a Brick's prices, as `brickyard-prices` writes them at deploy. */
export interface PriceTable {
  source: string;
  /** The store priced, such as "fr-FR". */
  locale: string;
  currency: string;
  /** In seconds. */
  fetched_at: number;
  /** LDraw "part:color" -> [price in cents, 1 if in stock, LEGO element id]. */
  prices: Record<string, [number, 0 | 1, string]>;
}

/** One element to order, with its quantity. */
export interface Line {
  element: string;
  quantity: number;
  cents: number;
  inStock: boolean;
}

export interface Estimate {
  cents: number;
  /** Pieces with a Pick a Brick price. */
  priced: number;
  /** Pieces Pick a Brick does not sell in their part and color. */
  missing: number;
  /** Priced pieces that are out of stock now. */
  outOfStock: number;
  lines: Line[];
}

const TABLE = "/pick-a-brick.json";
/** Pick a Brick's list upload takes at most 400 different elements. */
export const UPLOAD_LIMIT = 400;

let table: Promise<PriceTable | null> | null = null;

/** The deployed price table, or null when the app was built without one. */
function prices(): Promise<PriceTable | null> {
  // A static host answers a missing file with the app's page, so a table that does not parse is no table.
  table ??= loadAsset(TABLE, new AbortController().signal)
    .then((text) => {
      const parsed: PriceTable = JSON.parse(text);
      return parsed.currency && parsed.prices ? parsed : null;
    })
    .catch(() => null);
  return table;
}

/** The price table once loaded; null until then or without one. */
export function usePrices(): PriceTable | null {
  const [loaded, setLoaded] = useState<PriceTable | null>(null);
  useEffect(() => {
    let current = true;
    void prices().then((t) => current && setLoaded(t));
    return () => {
      current = false;
    };
  }, []);
  return loaded;
}

/** What the pieces would cost on Pick a Brick, and the elements to order, most first. */
export function estimate(pieces: Piece[], table: PriceTable): Estimate {
  const lines = new Map<string, Line>();
  let missing = 0;
  for (const p of pieces) {
    const price = table.prices[`${p.part}:${p.color}`];
    if (!price) {
      missing++;
      continue;
    }
    const [cents, inStock, element] = price;
    const line = lines.get(element);
    if (line) line.quantity++;
    else lines.set(element, { element, quantity: 1, cents, inStock: inStock === 1 });
  }
  const sorted = [...lines.values()].sort((a, b) => b.quantity - a.quantity);
  return {
    cents: sorted.reduce((sum, l) => sum + l.cents * l.quantity, 0),
    priced: pieces.length - missing,
    missing,
    outOfStock: sorted.reduce((n, l) => n + (l.inStock ? 0 : l.quantity), 0),
    lines: sorted,
  };
}

/** The lines as Pick a Brick upload files: `elementId,quantity` CSVs of at most 400 elements each. */
export function uploadLists(lines: Line[]): string[] {
  const files: string[] = [];
  for (let i = 0; i < lines.length; i += UPLOAD_LIMIT)
    files.push(
      ["elementId,quantity", ...lines.slice(i, i + UPLOAD_LIMIT).map((l) => `${l.element},${l.quantity}`)].join(
        "\r\n",
      ) + "\r\n",
    );
  return files;
}

export const money = (cents: number, table: PriceTable, whole = false) =>
  new Intl.NumberFormat(table.locale, {
    style: "currency",
    currency: table.currency,
    maximumFractionDigits: whole ? 0 : 2,
  }).format(cents / 100);

/** The Pick a Brick store the table was priced in. */
export const storeUrl = (table: PriceTable) =>
  `https://www.lego.com/${table.locale.toLowerCase()}/pick-and-build/pick-a-brick`;
