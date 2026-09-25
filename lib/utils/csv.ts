/**
 * RFC 4180 CSV parser. Quotes are tracked across the whole text, so a quoted
 * field may contain commas, doubled quotes (`""`), and line breaks — splitting
 * on '\n' first would cut such a field into two broken rows.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const endField = () => {
    row.push(field.trim());
    field = '';
  };
  const endRow = () => {
    endField();
    if (row.some((value) => value !== '')) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const char = text[i]!;
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      endField();
    } else if (char === '\n' || char === '\r') {
      if (char === '\r' && text[i + 1] === '\n') i++;
      endRow();
    } else {
      field += char;
    }
  }
  if (field !== '' || row.length > 0) endRow();

  return rows;
}

/** Rows keyed by the header row; missing trailing cells become ''. */
export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const [headers, ...rows] = parseCsv(text);
  if (!headers) return [];
  return rows.map((values) => {
    const record: Record<string, string> = {};
    headers.forEach((header, index) => {
      record[header] = values[index] ?? '';
    });
    return record;
  });
}
