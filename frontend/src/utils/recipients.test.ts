import { describe, expect, it } from 'vitest';
import { parseCsv, parseRecipientFile, parseRecipientText } from './recipients';

describe('parseRecipientText', () => {
  it('parses one address per line, trims and lowercases', () => {
    const res = parseRecipientText('  Alice@Example.com \nBOB@example.com\n');
    expect(res.valid).toEqual(['alice@example.com', 'bob@example.com']);
    expect(res.invalid).toEqual([]);
    expect(res.duplicatesRemoved).toBe(0);
  });

  it('splits on commas/semicolons and ignores blanks', () => {
    const res = parseRecipientText('a@example.com, b@example.com;c@example.com\n\n');
    expect(res.valid).toEqual(['a@example.com', 'b@example.com', 'c@example.com']);
  });

  it('removes case-insensitive duplicates and reports invalid tokens', () => {
    const res = parseRecipientText('a@example.com\nA@EXAMPLE.COM\nnot-an-email\nno-at-sign\nnot-an-email');
    expect(res.valid).toEqual(['a@example.com']);
    expect(res.duplicatesRemoved).toBe(1);
    expect(res.invalid).toEqual(['not-an-email', 'no-at-sign']);
  });
});

describe('parseCsv', () => {
  it('uses the email header column', () => {
    const res = parseCsv('name,email\nalice,alice@example.com\nbob,bob@example.com');
    expect(res.valid).toEqual(['alice@example.com', 'bob@example.com']);
  });

  it('picks the most email-like column when no email header exists', () => {
    const res = parseCsv('name,contact\nAlice,alice@example.com\nBob,bob@example.com');
    expect(res.valid).toEqual(['alice@example.com', 'bob@example.com']);
  });

  it('handles quoted fields with commas and header-less files', () => {
    const quoted = parseCsv('"Doe, Alice",alice@example.com\n"Smith, Bob",bob@example.com');
    expect(quoted.valid).toEqual(['alice@example.com', 'bob@example.com']);

    const headerless = parseCsv('carol@example.com\ndave@example.com');
    expect(headerless.valid).toEqual(['carol@example.com', 'dave@example.com']);
  });

  it('returns empty result for blank input', () => {
    expect(parseCsv('\n  \n')).toEqual({ valid: [], invalid: [], duplicatesRemoved: 0 });
  });
});

describe('parseRecipientFile', () => {
  it('routes by extension', () => {
    expect(parseRecipientFile('list.csv', 'email\na@example.com').valid).toEqual(['a@example.com']);
    expect(parseRecipientFile('list.txt', 'b@example.com').valid).toEqual(['b@example.com']);
    expect(parseRecipientFile('LIST.CSV', 'email\na@example.com').valid).toEqual(['a@example.com']);
  });
});
