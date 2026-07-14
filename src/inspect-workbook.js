import { config } from './config.js';
import { readCompanies } from './workbook.js';

const companies = readCompanies(config.workbookPath);
console.log(`Loaded ${companies.length} companies from ${config.workbookPath}`);
console.table(companies.slice(0, 15));

