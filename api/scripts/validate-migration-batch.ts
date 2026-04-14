#!/usr/bin/env tsx

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const batchDir = process.env.MIGRATION_OUTPUT_DIR?.trim()
  ? resolve(process.env.MIGRATION_OUTPUT_DIR)
  : null;

if (!batchDir) {
  console.error('MIGRATION_OUTPUT_DIR is required');
  process.exit(1);
}

const reportPath = resolve(batchDir, 'validation-report.json');
if (!existsSync(reportPath)) {
  console.error(`validation-report.json not found in ${batchDir}`);
  process.exit(1);
}

const report = JSON.parse(readFileSync(reportPath, 'utf8')) as {
  ok: boolean;
  errors: string[];
  warnings: string[];
};

console.log(`Validation report: ${report.ok ? 'OK' : 'FAILED'}`);
console.log(`Warnings: ${report.warnings.length}`);
console.log(`Errors: ${report.errors.length}`);

if (report.warnings.length > 0) {
  console.log('Warning sample:');
  for (const warning of report.warnings.slice(0, 10)) {
    console.log(`  - ${warning}`);
  }
}

if (report.errors.length > 0) {
  console.log('Error sample:');
  for (const error of report.errors.slice(0, 10)) {
    console.log(`  - ${error}`);
  }
  process.exit(1);
}
