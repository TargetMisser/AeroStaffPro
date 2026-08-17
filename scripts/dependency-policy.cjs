#!/usr/bin/env node
const { capture, fail } = require('./release-tools.cjs');

function printHelp() {
  console.log(`Usage: node scripts/dependency-policy.cjs [--production] [--strict]

Runs npm audit as a machine-readable release policy.

Default policy: fail on critical advisories and report all other severities.
  --production  Audit only production dependencies.
  --strict      Also fail when high-severity advisories are present.`);
}

function evaluateAudit(report, { strict = false } = {}) {
  const raw = report?.metadata?.vulnerabilities;
  if (!raw || typeof raw !== 'object') {
    return { ok: false, counts: null, reasons: ['npm audit output is missing vulnerability totals'] };
  }
  const counts = {
    info: Number(raw.info || 0),
    low: Number(raw.low || 0),
    moderate: Number(raw.moderate || 0),
    high: Number(raw.high || 0),
    critical: Number(raw.critical || 0),
    total: Number(raw.total || 0),
  };
  const reasons = [];
  if (counts.critical > 0) reasons.push(`${counts.critical} critical advisories`);
  if (strict && counts.high > 0) reasons.push(`${counts.high} high advisories in strict mode`);
  return { ok: reasons.length === 0, counts, reasons };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    printHelp();
    return;
  }
  const allowed = new Set(['--production', '--strict']);
  const unknown = args.find(arg => !allowed.has(arg));
  if (unknown) fail(`Unknown option: ${unknown}`);

  const auditArgs = ['audit', '--json'];
  if (args.includes('--production')) auditArgs.push('--omit=dev');
  const result = capture('npm', auditArgs, { allowFailure: true });
  let report;
  try {
    report = JSON.parse(result.stdout || '');
  } catch {
    fail(`npm audit did not return valid JSON.\n${result.stderr || result.stdout || ''}`.trim());
  }
  if (report.error) fail(`npm audit failed: ${report.error.summary || report.error.message || JSON.stringify(report.error)}`);

  const policy = evaluateAudit(report, { strict: args.includes('--strict') });
  if (!policy.counts) fail(policy.reasons.join('; '));
  const counts = policy.counts;
  console.log(`Dependency audit: critical=${counts.critical}, high=${counts.high}, moderate=${counts.moderate}, low=${counts.low}, total=${counts.total}.`);
  if (!policy.ok) fail(`Dependency policy failed: ${policy.reasons.join('; ')}.`);
  if (counts.high > 0) console.log('High advisories remain in the Expo/Metro/Storybook toolchain and require a controlled major upgrade.');
}

if (require.main === module) main();

module.exports = { evaluateAudit };
