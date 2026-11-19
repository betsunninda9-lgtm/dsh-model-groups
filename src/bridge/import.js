import fs from 'node:fs';
import path from 'node:path';

/** A private, explicit migration handoff captured before old schema removal. */
export function readBridgeImport(documentPath, home = process.env.DSH_HOME) {
  if (!home || !documentPath) return undefined;
  const file = path.join(home, 'dsh-model-groups', 'pending-bridge-import.json');
  if (!fs.existsSync(file)) return undefined;
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 4 * 1024 * 1024) throw new Error('INVALID_BRIDGE_IMPORT');
  const value = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (value.schema !== 1 || path.resolve(value.documentPath) !== path.resolve(documentPath)) return undefined;
  if (!value.providers || typeof value.providers !== 'object' || Array.isArray(value.providers)) throw new Error('INVALID_BRIDGE_IMPORT');
  return value.providers;
}
