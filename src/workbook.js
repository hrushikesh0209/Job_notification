import fs from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { XMLParser } from 'fast-xml-parser';

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: '#text',
  parseTagValue: false,
  trimValues: false,
});

const asArray = (value) => value == null ? [] : Array.isArray(value) ? value : [value];

function nodeText(value) {
  if (value == null) return '';
  if (typeof value === 'string' || typeof value === 'number') return String(value);
  if (Array.isArray(value)) return value.map(nodeText).join('');
  if (typeof value === 'object') {
    if (value['#text'] != null) return nodeText(value['#text']);
    if (value.t != null && typeof value.t !== 'string') return nodeText(value.t);
    if (value.t != null && Object.keys(value).length === 1) return nodeText(value.t);
    return Object.entries(value)
      .filter(([key]) => !['r', 's'].includes(key))
      .map(([, child]) => nodeText(child))
      .join('');
  }
  return '';
}

function columnNumber(reference = '') {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || 'A';
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0) - 1;
}

export function readCompanies(workbookPath) {
  const archive = unzipSync(fs.readFileSync(workbookPath));
  const sheetBytes = archive['xl/worksheets/sheet1.xml'];
  if (!sheetBytes) throw new Error('The workbook does not contain xl/worksheets/sheet1.xml');

  let sharedStrings = [];
  if (archive['xl/sharedStrings.xml']) {
    const shared = parser.parse(strFromU8(archive['xl/sharedStrings.xml']));
    sharedStrings = asArray(shared.sst?.si).map(nodeText);
  }

  const sheet = parser.parse(strFromU8(sheetBytes));
  const rows = asArray(sheet.worksheet?.sheetData?.row).map((row) => {
    const values = [];
    for (const cell of asArray(row.c)) {
      const index = columnNumber(cell.r);
      if (cell.t === 's') values[index] = sharedStrings[Number(cell.v)] || '';
      else if (cell.t === 'inlineStr') values[index] = nodeText(cell.is?.t ?? cell.is);
      else values[index] = nodeText(cell.v);
    }
    return values.map((value) => String(value || '').trim());
  });

  const [headers = [], ...records] = rows;
  const normalized = headers.map((header) => header.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim());
  const companyIndex = normalized.findIndex((header) => header.includes('company'));
  const urlIndex = normalized.findIndex((header) => header.includes('url') || header.includes('portal'));
  const categoryIndex = normalized.findIndex((header) => header.includes('category'));
  const priorityIndex = normalized.findIndex((header) => header.includes('priority'));

  if (companyIndex < 0 || urlIndex < 0) throw new Error('Expected Company Name and Career Portal URL columns');

  return records
    .map((row, index) => ({
      company: row[companyIndex] || '',
      portalUrl: row[urlIndex] || '',
      category: categoryIndex >= 0 ? row[categoryIndex] || '' : '',
      priority: priorityIndex >= 0 ? row[priorityIndex] || '' : '',
      workbookRow: index + 2,
    }))
    .filter((record) => record.company && /^https?:\/\//i.test(record.portalUrl));
}
