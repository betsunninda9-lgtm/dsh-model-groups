import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { inspectPatches } from '../scripts/native-patches.mjs';

export function patchStorage(root, home) {
  return path.join(home, 'dsh-model-groups', crypto.createHash('sha256').update(fs.realpathSync(root)).digest('hex').slice(0, 16));
}
export function readPatchPreferences(root, home, artifacts) {
  const storage = patchStorage(root, home);
  if (fs.existsSync(path.join(storage, 'restore-pending.json'))) return { enabled: false, autoMaintenance: false };
  const file = path.join(storage, 'preferences.json');
  if (fs.existsSync(file)) {
    const stat = fs.lstatSync(file);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Invalid patch preferences');
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value.version !== 1 || typeof value.enabled !== 'boolean' || typeof value.autoMaintenance !== 'boolean') throw new Error('Invalid patch preferences');
    return { enabled: value.enabled, autoMaintenance: value.enabled && value.autoMaintenance };
  }
  // Migrate only evidence of an already installed patch. Plain package presence
  // and an ordinary pristine runtime are deliberately not enablement evidence.
  let enabled = false;
  try {
    enabled = fs.readdirSync(path.join(storage, 'backups')).some(name => /^dsh-(?:llm-pi-ai|client-ui-settings-models|llm|api-remotes)-.+-[a-f0-9]{64}\.js$/.test(name));
  } catch { /* No historical backup evidence. */ }
  if (!enabled) {
    try { enabled = inspectPatches(root, artifacts).files.some(item => item.state === 'patched'); } catch { /* New/unknown host remains opt-in. */ }
  }
  return { enabled, autoMaintenance: enabled };
}
export function writePatchPreferences(root, home, preferences) {
  const storage = patchStorage(root, home);
  fs.mkdirSync(storage, { recursive: true, mode: 0o700 });
  const file = path.join(storage, 'preferences.json');
  if (fs.existsSync(file) && (!fs.lstatSync(file).isFile() || fs.lstatSync(file).isSymbolicLink())) throw new Error('Invalid patch preferences');
  const temp = path.join(storage, `preferences-${crypto.randomUUID()}.tmp`);
  fs.writeFileSync(temp, JSON.stringify({ version: 1, enabled: !!preferences.enabled, autoMaintenance: !!preferences.enabled && !!preferences.autoMaintenance }), { mode: 0o600, flag: 'wx' });
  fs.renameSync(temp, file);
}
