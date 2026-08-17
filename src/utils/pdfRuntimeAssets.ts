import { Asset } from 'expo-asset';
import * as FileSystem from 'expo-file-system/legacy';
import type { PdfJsRuntimeSources } from './pdfShiftParser';

const libraryAsset = require('../../assets/vendor/pdf.min.pdfjs');
const workerAsset = require('../../assets/vendor/pdf.worker.min.pdfjs');

let runtimePromise: Promise<PdfJsRuntimeSources> | null = null;

async function readBundledSource(moduleId: number): Promise<string> {
  const asset = Asset.fromModule(moduleId);
  await asset.downloadAsync();
  const uri = asset.localUri;
  if (!uri) throw new Error(`PDF_RUNTIME_ASSET_UNAVAILABLE:${asset.name}`);
  return FileSystem.readAsStringAsync(uri, { encoding: FileSystem.EncodingType.UTF8 });
}

export function loadPdfJsRuntimeSources(): Promise<PdfJsRuntimeSources> {
  if (!runtimePromise) {
    runtimePromise = Promise.all([
      readBundledSource(libraryAsset),
      readBundledSource(workerAsset),
    ]).then(([library, worker]) => ({ library, worker }));
  }
  return runtimePromise;
}
