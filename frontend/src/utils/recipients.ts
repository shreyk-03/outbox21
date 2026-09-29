const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export interface ParsedRecipients {
  /** Unique, lowercased, valid addresses in first-seen order. */
  valid: string[];
  /** Raw tokens that are not valid addresses (deduped, in first-seen order). */
  invalid: string[];
  /** Valid addresses dropped because they were already seen (case-insensitive). */
  duplicatesRemoved: number;
}

function collect(tokens: string[]): ParsedRecipients {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seenValid = new Set<string>();
  const seenInvalid = new Set<string>();
  let duplicatesRemoved = 0;
  for (const raw of tokens) {
    const token = raw.trim();
    if (!token) continue;
    if (EMAIL_RE.test(token)) {
      const normalized = token.toLowerCase();
      if (seenValid.has(normalized)) {
        duplicatesRemoved += 1;
      } else {
        seenValid.add(normalized);
        valid.push(normalized);
      }
    } else if (!seenInvalid.has(token)) {
      seenInvalid.add(token);
      invalid.push(token);
    }
  }
  return { valid, invalid, duplicatesRemoved };
}

/** Manual textarea / TXT input: one address per line; commas/semicolons also split. */
export function parseRecipientText(text: string): ParsedRecipients {
  const tokens = text.split(/[\n,;]+/);
  return collect(tokens);
}

function splitCsvLine(line: string): string[] {
  // Minimal CSV parser supporting quoted fields with commas and "" escapes.
  const cells: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          current += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        current += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ',') {
      cells.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  cells.push(current);
  return cells.map((c) => c.trim());
}

/**
 * CSV input: if the first row looks like a header, detect the email column
 * (a cell containing "email", else the most email-like column); otherwise
 * treat every cell as a candidate address.
 */
export function parseCsv(text: string): ParsedRecipients {
  const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
  if (lines.length === 0) return { valid: [], invalid: [], duplicatesRemoved: 0 };
  const rows = lines.map(splitCsvLine);
  const first = rows[0] ?? [];
  const looksLikeHeader = first.some((c) => /email/i.test(c)) || first.every((c) => !EMAIL_RE.test(c));

  if (!looksLikeHeader) {
    return collect(rows.flat());
  }

  let emailCol = first.findIndex((c) => /email/i.test(c));
  if (emailCol === -1) {
    // No explicit email header: score each column by email-likeness.
    let best = 0;
    let bestScore = -1;
    for (let col = 0; col < first.length; col++) {
      let score = 0;
      for (let r = 1; r < rows.length; r++) {
        const cell = rows[r]?.[col] ?? '';
        if (EMAIL_RE.test(cell)) score += 1;
      }
      if (score > bestScore) {
        bestScore = score;
        best = col;
      }
    }
    emailCol = best;
  }
  return collect(rows.slice(1).map((r) => r[emailCol] ?? ''));
}

export function parseRecipientFile(fileName: string, text: string): ParsedRecipients {
  return /\.csv$/i.test(fileName) ? parseCsv(text) : parseRecipientText(text);
}

export const MAX_FILE_BYTES = 2 * 1024 * 1024;
export const ACCEPTED_EXTENSIONS = ['.csv', '.txt'] as const;

export function isAcceptedFile(fileName: string): boolean {
  return /\.(csv|txt)$/i.test(fileName);
}
