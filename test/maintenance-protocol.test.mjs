import assert from 'node:assert/strict';
import test from 'node:test';
import { maintenanceSnapshot, createMaintenanceController } from '../src/maintenance-state.js';

const sample = (overrides = {}) => ({ phase: 'idle', restartRequired: false, patches: [{ state: 'pristine' }], blockers: [], canApply: false, canRestoreOnly: false, canRestore: false, ...overrides });
test('blocked backend response without token remains a verifiable status', async () => {
  const payload = sample({ blockers: [{ code: 'key_config_dependency', message: 'blocked', count: 1 }] });
  const decoded = maintenanceSnapshot(JSON.parse(JSON.stringify(payload)));
  assert.equal(decoded.token, null);
  const controller = createMaintenanceController({ request: async () => ({ ok: true, json: async () => ({ ok: true, value: payload }) }) });
  await controller.refresh();
  assert.equal(controller.getSnapshot().error, '');
  assert.equal(controller.getSnapshot().snapshot.blockers[0].code, 'key_config_dependency');
});
test('removed response without token remains confirmed and only removes owned preferences', async () => {
  const removed = [];
  const controller = createMaintenanceController({ request: async () => ({ ok: true, json: async () => ({ ok: true, value: sample({ phase: 'removed', restartRequired: true, patches: [] }) }) }), storage: () => ({ removeItem: key => removed.push(key) }) });
  await controller.refresh();
  assert.equal(controller.getSnapshot().snapshot.phase, 'removed');
  assert.equal(removed.length, 2);
});
test('strict extended API shape requires flags and token for any allowed action', () => {
  for (const capability of ['canApply', 'canRestoreOnly', 'canRestore']) {
    const missing = sample(); delete missing[capability];
    assert.throws(() => maintenanceSnapshot(missing), /Invalid maintenance snapshot/);
    for (const value of [1, 'true', null]) assert.throws(() => maintenanceSnapshot(sample({ [capability]: value })), /Invalid maintenance snapshot/);
    for (const token of [undefined, null, '', 42]) assert.throws(() => maintenanceSnapshot(sample({ [capability]: true, token })), /Invalid maintenance snapshot/);
    assert.equal(maintenanceSnapshot(sample({ [capability]: true, token: 'ticket' }))[capability], true);
  }
  for (const invalid of [sample({ phase: 'unknown' }), sample({ restartRequired: 0 }), sample({ patches: [{ state: 'unknown' }] }), sample({ blockers: [{ code: 'bad', message: 'x', count: '1' }] })]) {
    assert.throws(() => maintenanceSnapshot(invalid), /Invalid maintenance snapshot/);
  }
  assert.equal(maintenanceSnapshot(sample({ phase: 'applied' })).phase, 'applied');
});
