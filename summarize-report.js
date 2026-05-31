const fs = require('fs');

const report = JSON.parse(fs.readFileSync('react-doctor-report-2.json', 'utf16le').replace(/^\uFEFF/, ''));
const counts = {};
const errors = [];

console.log(report.diagnostics[0]);
report.diagnostics.forEach(diag => {
  const rule = diag.rule;
  const level = diag.severity || diag.level || 'unknown';
  
  if (level === 'error' || level === 2) {
    errors.push(diag);
  }

  if (!counts[rule]) {
    counts[rule] = { count: 0, level };
  }
  counts[rule].count++;
});

console.log('--- ERRORS ---');
errors.forEach(e => {
  console.log(`[${e.rule}] ${e.filePath}:${e.line} - ${e.message}`);
});

console.log('\n--- ALL ISSUES BY RULE ---');
Object.entries(counts)
  .sort((a, b) => b[1].count - a[1].count)
  .forEach(([rule, data]) => {
    console.log(`${rule} (${data.level}): ${data.count}`);
  });
