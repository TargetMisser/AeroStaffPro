#!/usr/bin/env node
const fs = require('fs');
const os = require('os');
const path = require('path');
const { fail, root, run } = require('./release-tools.cjs');

const MAX_BUNDLE_BYTES = 6.5 * 1024 * 1024;
const FORBIDDEN_BUNDLE_MARKERS = [
  '@storybook',
  'DesignLabScreen',
  'cinematic-motion-board',
  'EXPO_PUBLIC_STORYBOOK_ENABLED',
  'cdn.jsdelivr.net/npm/tesseract',
  'cdnjs.cloudflare.com/ajax/libs/pdf.js',
];

function printHelp() {
  console.log(`Usage: node scripts/verify-production-bundle.cjs [--keep]

Exports the Android production bundle to an isolated temporary directory and
checks that development-only code and remote OCR/PDF runtimes are not shipped.

Options:
  --keep  Preserve the temporary export directory for manual inspection.`);
}

function inspectExport(exportDir) {
  const metadataPath = path.join(exportDir, 'metadata.json');
  if (!fs.existsSync(metadataPath)) fail(`Expo export metadata is missing: ${metadataPath}`);

  const metadata = JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const android = metadata.fileMetadata?.android;
  if (!android?.bundle || !Array.isArray(android.assets)) {
    fail('Expo export metadata does not contain an Android bundle and asset list.');
  }

  const bundlePath = path.join(exportDir, ...android.bundle.split(/[\\/]/));
  if (!fs.existsSync(bundlePath)) fail(`Android production bundle is missing: ${bundlePath}`);
  const bundle = fs.readFileSync(bundlePath);

  const forbidden = FORBIDDEN_BUNDLE_MARKERS.filter(marker => bundle.includes(Buffer.from(marker)));
  if (forbidden.length > 0) {
    fail(`Production bundle contains forbidden development/remote markers: ${forbidden.join(', ')}`);
  }
  if (bundle.length > MAX_BUNDLE_BYTES) {
    fail(`Production bundle is ${(bundle.length / 1024 / 1024).toFixed(2)} MiB; limit is ${(MAX_BUNDLE_BYTES / 1024 / 1024).toFixed(2)} MiB.`);
  }

  const extensions = android.assets.map(asset => String(asset.ext || '').toLowerCase());
  const fontCount = extensions.filter(ext => ext === 'ttf').length;
  const pdfRuntimeCount = extensions.filter(ext => ext === 'pdfjs').length;
  if (fontCount !== 2) fail(`Production export must contain exactly 2 icon fonts; found ${fontCount}.`);
  if (pdfRuntimeCount !== 2) fail(`Production export must contain the PDF.js library and worker; found ${pdfRuntimeCount} .pdfjs assets.`);

  return {
    bundlePath,
    bundleBytes: bundle.length,
    assetCount: android.assets.length,
    fontCount,
    pdfRuntimeCount,
  };
}

function removeTemporaryExport(exportDir) {
  const tempRoot = path.resolve(os.tmpdir());
  const resolved = path.resolve(exportDir);
  if (path.dirname(resolved) !== tempRoot || !path.basename(resolved).startsWith('aerostaff-production-bundle-')) {
    fail(`Refusing to remove unexpected export directory: ${resolved}`);
  }
  fs.rmSync(resolved, { recursive: true, force: true });
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  const unknown = args.filter(arg => arg !== '--keep');
  if (unknown.length > 0) fail(`Unknown option: ${unknown[0]}`);

  const exportDir = fs.mkdtempSync(path.join(os.tmpdir(), 'aerostaff-production-bundle-'));
  const keep = args.includes('--keep');
  try {
    run('npx', ['expo', 'export', '--platform', 'android', '--output-dir', exportDir, '--clear'], {
      cwd: root,
      env: {
        NODE_ENV: 'production',
        EXPO_PUBLIC_STORYBOOK_ENABLED: '',
      },
    });
    const result = inspectExport(exportDir);
    console.log(`Production bundle verified: ${(result.bundleBytes / 1024 / 1024).toFixed(2)} MiB, ${result.assetCount} assets, ${result.fontCount} fonts, ${result.pdfRuntimeCount} PDF.js assets.`);
    if (keep) console.log(`Export retained at: ${exportDir}`);
  } finally {
    if (!keep && fs.existsSync(exportDir)) removeTemporaryExport(exportDir);
  }
}

if (require.main === module) main();

module.exports = {
  FORBIDDEN_BUNDLE_MARKERS,
  MAX_BUNDLE_BYTES,
  inspectExport,
  removeTemporaryExport,
};
