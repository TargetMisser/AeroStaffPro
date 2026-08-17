const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const sourceDir = path.join(root, 'node_modules', 'pdfjs-dist', 'build');
const outputDir = path.join(root, 'assets', 'vendor');
const assets = [
  ['pdf.min.mjs', 'pdf.min.pdfjs'],
  ['pdf.worker.min.mjs', 'pdf.worker.min.pdfjs'],
];

fs.mkdirSync(outputDir, { recursive: true });

for (const [sourceName, outputName] of assets) {
  const source = path.join(sourceDir, sourceName);
  const output = path.join(outputDir, outputName);
  if (!fs.existsSync(source)) {
    throw new Error(`Missing pinned PDF.js asset: ${source}`);
  }
  fs.copyFileSync(source, output);
}

console.log('Prepared local PDF.js assets from the pinned pdfjs-dist dependency.');
