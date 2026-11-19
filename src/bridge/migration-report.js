import fs from 'node:fs';
import path from 'node:path';
import { readBridgeImport } from './import.js';

const STAGES = new Set(['waiting', 'recover', 'import', 'synchronize', 'complete', 'failed']);
const CODES = new Set(['SETTINGS_UNAVAILABLE', 'NATIVE_CONFIG_CONFLICT', 'REVISION_MISMATCH', 'INVALID_BRIDGE_IMPORT', 'BRIDGE_PROJECTION_UNSUPPORTED', 'UNKNOWN_MODEL', 'UNKNOWN_PROVIDER', 'INVALID_MODEL_CAPABILITY', 'CONFIG_OVERLAY', 'CONFIG_ENTRY_UNAVAILABLE', 'CONFIG_ENTRY_CHANGED', 'CONFIG_PLUGIN_INACTIVE', 'CONFIG_FIELD_NOT_VOLATILE', 'CONFIG_DOCUMENT_INVALID', 'HMR_MIGRATION_DEFERRED']);
/** Private, bounded migration progress. Never serialize errors or configuration. */
export function reportBridgeImport(documentPath, result, home = process.env.DSH_HOME) {
  try {
    if (!readBridgeImport(documentPath, home) || !STAGES.has(result.stage)) return;
    const file = path.join(home, 'dsh-model-groups', 'bridge-import-result.json');
    if (fs.existsSync(file)) {
      const stat = fs.lstatSync(file);
      if (!stat.isFile() || stat.isSymbolicLink()) return;
    }
    const report = { schema: 1, stage: result.stage, updatedAt: new Date().toISOString() };
    if (result.stage === 'failed') {
      report.code = CODES.has(result.code) ? result.code : 'INITIALIZATION_FAILED';
      if (STAGES.has(result.step)) report.step = result.step;
      if (['Error', 'TypeError', 'DataCloneError', 'SyntaxError', 'SettingsError'].includes(result.errorType)) report.errorType = result.errorType;
      if (['dsh-config-editor', 'dsh-settings', 'schemastery'].includes(result.origin)) report.origin = result.origin;
      if (Number.isSafeInteger(result.originLine) && result.originLine > 0) report.originLine = result.originLine;
      if (Array.isArray(result.frames)) report.frames = result.frames.filter(line => Number.isSafeInteger(line) && line > 0 && line < 1000000).slice(0, 4);
    }
    if (typeof result.clientRegistered === 'boolean') report.clientRegistered = result.clientRegistered;
    for (const key of ['imported', 'conflicts', 'activated']) if (Number.isSafeInteger(result[key]) && result[key] >= 0) report[key] = result[key];
    fs.writeFileSync(file, JSON.stringify(report), { mode: 0o600 });
  } catch { /* Diagnostics must never alter the migration's outcome. */ }
}
