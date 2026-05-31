const fs = require('fs');
const report = JSON.parse(fs.readFileSync('react-doctor-report.json', 'utf16le').replace(/^\uFEFF/, ''));
const unusedFiles = report.diagnostics.filter(d => d.rule === 'unused-file').map(d => d.filePath);
console.log('Unused files count:', unusedFiles.length);
console.log(unusedFiles.slice(0, 20).join('\n'));
