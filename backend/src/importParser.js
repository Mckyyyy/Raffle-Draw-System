/**
 * Turns an uploaded file (CSV / TXT / XLSX / XLS / DOCX / DOC / PDF) into a list
 * of participant names — with NO required header or layout.
 *
 * How detection works
 *  - Tabular files (CSV, Excel, and text that is clearly tab/comma separated):
 *      1. If the first non-blank row has a header cell like "Name", "Full Name",
 *         "Participant", "Full_Name", … that column is used and the row skipped.
 *      2. Otherwise every column is scored by how many of its cells look like a
 *         person's name, and the best column wins.
 *  - Free text (Word, PDF, TXT): every line is a candidate.
 *  - Every candidate is cleaned (numbering "1.", "1)", bullets, quotes, extra
 *    spaces removed) and kept only if it looks like a name: mostly letters,
 *    1–8 words, not an email / phone / code / header word / page marker.
 *
 * Nothing else from the file (entry codes, other columns) is required or used.
 */
const path = require('path');
const XLSX = require('xlsx');
const WordExtractor = require('word-extractor');

class ImportError extends Error {
  constructor(message, detail) { super(message); this.detail = detail; this.status = 400; }
}

const NO_NAMES = () => new ImportError(
  'No participant names found',
  'The file was read, but nothing in it looked like a person\'s name. Put one name per line or row ' +
  '(e.g. "Juan Dela Cruz"). Numbering such as "1." or "1)", blank lines, and a header row like ' +
  '"Name" / "Full Name" / "Participant" are all fine.'
);

/* ------------------------------------------------------------------ */
/* Text helpers                                                        */
/* ------------------------------------------------------------------ */

const norm = (s) => String(s ?? '').replace(/^﻿/, '').replace(/\s+/g, ' ').trim();

/** Header words we recognise (after lower-casing and stripping punctuation). */
const HEADER_WORDS = new Set([
  'name', 'names', 'fullname', 'full name', 'full_name', 'participant', 'participants', 'participant name',
  'participantname', 'participant names', 'employee', 'employee name', 'member', 'member name', 'attendee',
  'attendees', 'attendee name', 'winner', 'winners', 'entrant', 'entrants', 'person', 'people', 'complete name',
  'name of participant', 'name of participants', 'list of participants', 'list of names', 'raffle entries',
  'entries', 'entry', 'no', 'no.', '#', 'number', 'id', 'seq', 'count',
]);
/** Words that mark a title, section heading or column label rather than a person. */
const NOT_A_NAME = /(^|\s)(participants?|raffle|list|masterlist|master|municipality|municipal|barangay|attendance|sheet|names?|event|draw|form|department|office|committee|program|schedule|venue|prizes?|winners?|entries|province|city|region|lgu|cover|table|column|row|sample|test|example|lorem|ipsum|nothing|here)(\s|$)/i;
const headerKey = (s) => norm(s).toLowerCase().replace(/[^a-z0-9 _.#]/g, '').replace(/\s+/g, ' ').trim();
const isHeaderWord = (s) => HEADER_WORDS.has(headerKey(s));
/** snake_case / lowercase single tokens are column labels, not people */
const isIdentifierLike = (s) => /^[a-z][a-z0-9_]*$/.test(norm(s)) || /_/.test(norm(s));

/** A header cell that specifically means "this column holds names". */
function isNameHeader(s) {
  const k = headerKey(s).replace(/[_.]/g, ' ').replace(/\s+/g, ' ').trim();
  if (k === 'full name' || k === 'fullname' || k === 'name') return true;
  const mentionsName = /(^|\s)(name|names|fullname|participant|participants|attendee|attendees|member|members|employee|entrant|entrants|person)(\s|$)/.test(k);
  const isSomethingElse = /(^|\s)(code|id|number|no|email|phone|contact|address)(\s|$)/.test(k);
  return mentionsName && !isSomethingElse;
}

/** Strip list numbering / bullets / stray quotes: "1. Juan" "1) Juan" "• Juan" "- Juan" "(1) Juan" */
function cleanCandidate(raw) {
  let s = norm(raw);
  s = s.replace(/^[\s"'“”‘’`]+|[\s"'“”‘’`]+$/g, '');
  s = s.replace(/^\(?\d{1,4}\s*[.):\-–—]?\s+/, '');      // "1. Juan" / "1) Juan" / "(1) Juan" / "12 - Juan"
  s = s.replace(/^\d{1,4}[.)]\s*/, '');                  // "1.Juan" (no space)
  s = s.replace(/^[•·◦▪▫‣\-–—*+>]+\s*/, '');            // bullets / dashes
  s = s.replace(/\s*[;:,]+$/, '');                       // trailing punctuation (periods kept: "Jr.", "Sr.")
  return s.replace(/\s+/g, ' ').trim();
}

/** Does this cleaned string look like a person's name? */
function looksLikeName(s) {
  if (!s || s.length < 2 || s.length > 100) return false;
  if (isHeaderWord(s)) return false;
  if (/^-- \d+ of \d+ --$/.test(s)) return false;                 // pdf page marker
  if (/@/.test(s) || /https?:\/\//i.test(s) || /www\./i.test(s)) return false;
  if (/^\+?[\d\s\-().]{6,}$/.test(s)) return false;              // phone / number
  if (/^[A-Z]{1,6}[-_ ]?\d{2,}$/i.test(s)) return false;          // codes: GL-1A2B3C, STUB-0001, ID12345
  if (/^\d+$/.test(s)) return false;
  if (/^(page|total|date|signature|remarks?|prepared by|noted by|approved by|certified by|submitted by)\b/i.test(s)) return false;
  if (NOT_A_NAME.test(s)) return false;                           // titles / headings / labels
  if (/_/.test(s) || /,\S/.test(s)) return false;                 // snake_case labels, "A,B"
  const letters = (s.match(/\p{L}/gu) || []).length;
  if (letters < 2) return false;
  if (letters / s.length < 0.6) return false;                     // mostly letters
  if (/[^\p{L}\p{M}\s.'’,\-()/&]/u.test(s)) return false;         // only name-ish characters
  const words = s.split(' ').length;
  if (words > 8) return false;
  if (letters < 3 && words < 2) return false;                     // "A" or "Li" alone is not enough evidence
  return true;
}

/* ------------------------------------------------------------------ */
/* Tabular detection                                                   */
/* ------------------------------------------------------------------ */

/** Split one line on tabs (if present) or commas, honouring double quotes. */
function splitDelimited(line) {
  const delim = line.includes('\t') ? '\t' : ',';
  const out = []; let cur = ''; let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === delim) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur);
  return out.map(norm);
}

/**
 * rows: string[][]. Finds the column that holds names and returns the cleaned,
 * name-like values from it in file order.
 */
function namesFromRows(rows) {
  const nonBlank = rows.map((r) => r.map(norm)).filter((r) => r.some((c) => c !== ''));
  if (nonBlank.length === 0) return [];
  const width = Math.max(...nonBlank.map((r) => r.length));

  // 1. Header row?  (a cell that names the column, or a row made only of header words)
  const first = nonBlank[0];
  const headerCol = first.findIndex(isNameHeader);
  const firstIsHeader = headerCol >= 0 || first.every((c) => c === '' || isHeaderWord(c) || isIdentifierLike(c));
  const body = firstIsHeader ? nonBlank.slice(1) : nonBlank;

  // 2. Pick the column: the header wins, otherwise the most name-like column.
  let col = headerCol;
  if (col < 0) {
    let best = 0;
    for (let c = 0; c < width; c++) {
      const score = body.reduce((n, r) => n + (looksLikeName(cleanCandidate(r[c])) ? 1 : 0), 0);
      if (score > best) { best = score; col = c; }
    }
    if (best === 0) return [];
  }

  return body.map((r) => cleanCandidate(r[col])).filter(looksLikeName);
}

/* ------------------------------------------------------------------ */
/* Free-text detection                                                 */
/* ------------------------------------------------------------------ */

function namesFromText(text) {
  const lines = String(text || '').split(/\r?\n|\r/).map(norm).filter(Boolean);
  if (lines.length === 0) return [];

  // If most lines are tab/comma separated the text is really a table (a Word table, an exported sheet…)
  const delimited = lines.filter((l) => /\t/.test(l) || l.split(',').length >= 3).length;
  if (delimited >= Math.max(2, Math.ceil(lines.length * 0.6))) {
    const fromTable = namesFromRows(lines.map(splitDelimited));
    if (fromTable.length) return fromTable;
  }

  // Otherwise one candidate per line. "Dela Cruz, Juan" stays one name; a line holding several
  // names ("Juan Dela Cruz; Maria Santos", or wide spacing) is split only if every piece is a name.
  const out = [];
  for (const line of lines) {
    const single = cleanCandidate(line);
    if (looksLikeName(single)) { out.push(single); continue; }
    const parts = line.split(/[;\t]|\s{3,}/).map(cleanCandidate).filter(Boolean);
    if (parts.length > 1 && parts.every(looksLikeName)) out.push(...parts);
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Format readers                                                      */
/* ------------------------------------------------------------------ */

function parseCsvText(text, preferLines = false) {
  const clean = String(text).replace(/^﻿/, '');
  const lines = clean.split(/\r?\n/).map(norm).filter(Boolean);
  // "Dela Cruz, Juan" style — at most one comma per line, always followed by a space, no tabs → one name per line
  const lastFirst = lines.length > 0 && lines.every((l) => !/\t/.test(l) && (l.match(/,/g) || []).length <= 1 && !/,\S/.test(l));
  if (preferLines || lastFirst) {
    const fromLines = namesFromText(clean);
    if (fromLines.length) return fromLines;
  }
  const names = namesFromRows(lines.map(splitDelimited));
  return names.length ? names : namesFromText(clean);
}

function parseExcel(buffer) {
  const wb = XLSX.read(buffer, { type: 'buffer' });
  let best = [];
  for (const sheetName of wb.SheetNames) {          // scan every sheet; the one with the most names wins
    const sheet = wb.Sheets[sheetName];
    if (!sheet) continue;
    const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false, defval: '' });
    const names = namesFromRows(rows.map((r) => r.map((c) => String(c ?? ''))));
    if (names.length > best.length) best = names;
  }
  return best;
}

async function parseWord(buffer) {
  const doc = await new WordExtractor().extract(buffer);
  return namesFromText(doc.getBody());
}

async function parsePdf(buffer) {
  const { PDFParse } = require('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return namesFromText((result.text || '').replace(/^\s*-- \d+ of \d+ --\s*$/gm, ''));
  } finally {
    if (typeof parser.destroy === 'function') await parser.destroy();
  }
}

/** @returns {Promise<string[]>} detected names in file order; throws ImportError when none are found */
async function extractNames(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  let names;
  switch (ext) {
    case '.csv':
      names = parseCsvText(file.buffer.toString('utf8')); break;
    case '.txt':
      names = parseCsvText(file.buffer.toString('utf8'), true); break;
    case '.xlsx':
    case '.xls':
      names = parseExcel(file.buffer); break;
    case '.docx':
    case '.doc':
      names = await parseWord(file.buffer); break;
    case '.pdf':
      names = await parsePdf(file.buffer); break;
    default:
      throw new ImportError('Unsupported file type', 'Supported: .csv, .txt, .xlsx, .xls, .docx, .doc, .pdf');
  }
  if (!names.length) throw NO_NAMES();
  return names;
}

module.exports = { extractNames, namesFromRows, namesFromText, cleanCandidate, looksLikeName, ImportError };
