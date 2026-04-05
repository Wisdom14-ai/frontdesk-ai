export interface ParsedCsvResult {
  headers: string[];
  rows: string[][];
}

export function parseCsv(text: string): ParsedCsvResult {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentCell = "";
  let inQuotes = false;

  const pushCell = () => {
    currentRow.push(currentCell.trim());
    currentCell = "";
  };

  const pushRow = () => {
    if (currentRow.some((value) => value.length > 0)) {
      rows.push(currentRow);
    }
    currentRow = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    const next = text[index + 1];

    if (character === "\"") {
      if (inQuotes && next === "\"") {
        currentCell += "\"";
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (character === "," && !inQuotes) {
      pushCell();
      continue;
    }

    if ((character === "\n" || character === "\r") && !inQuotes) {
      if (character === "\r" && next === "\n") {
        index += 1;
      }
      pushCell();
      pushRow();
      continue;
    }

    currentCell += character;
  }

  if (currentCell.length > 0 || currentRow.length > 0) {
    pushCell();
    pushRow();
  }

  if (rows.length === 0) {
    return { headers: [], rows: [] };
  }

  const firstRow = rows[0];
  const headerLooksReal = firstRow.some((value) => /name|phone|mobile|campaign|source|treatment/i.test(value));

  if (headerLooksReal) {
    return {
      headers: firstRow,
      rows: rows.slice(1),
    };
  }

  return {
    headers: firstRow.map((_, index) => `Column ${index + 1}`),
    rows,
  };
}

export function guessColumn(headers: string[], pattern: RegExp) {
  return headers.find((header) => pattern.test(header)) ?? "";
}
