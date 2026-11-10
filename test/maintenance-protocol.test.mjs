import assert from 'node:assert/strict';
import test from 'node:test';
import { maintenanceSnapshot, createMaintenanceController } from '../src/maintenance-state.js';

test('blocked backend response without token remains a verifiable status', async () => {
  const payload = { phase: 'idle', restartRequired: false, patches: [{ name: 'pi-ai', state: 'patched' }], blockers: [{ code: 'key_config_dependency', message: 'blocked', count: 1 }], canRestore: false };
  const decoded = maintenanceSnapshot(JSON.parse(JSON.stringify(payload)));
  assert.equal(decoded.token, null);
  const controller = createMaintenanceController({ request: async () => ({ ok: true, json: async () => ({ ok: true, value: payload }) }) });
  await controller.refresh();
  assert.equal(controller.getSnapshot().error, '');
  assert.equal(controller.getSnapshot().snapshot.blockers[0].code, 'key_config_dependency');
});
test('removed response without token remains confirmed and only removes owned preferences', async () => {
  const removed = [];
  const controller = createMaintenanceController({ request: async () => ({ ok: true, json: async () => ({ ok: true, value: { phase: 'removed', restartRequired: true, patches: [], blockers: [], canRestore: false } }) }), storage: () => ({ removeItem: key => removed.push(key) }) });
  await controller.refresh();
  assert.equal(controller.getSnapshot().snapshot.phase, 'removed');
  assert.equal(removed.length, 2);
});
