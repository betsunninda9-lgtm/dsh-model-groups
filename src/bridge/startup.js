/** Wait for the owner's volatile Settings form to become visible after apply.
 * Settings excludes a plugin while its fiber is still activating. */
export function startBridgeWhenSettingsReady(ctx, namespace, initialize) {
  let stopped = false, checking = false, running, complete = false;
  const removers = [];
  const ready = () => ctx.settings.describe().some(item => item.ns === namespace);
  function attempt() {
    if (stopped || complete || running || checking) return running;
    let visible = false;
    checking = true;
    try { visible = ready(); }
    catch { return; }
    finally { checking = false; }
    if (!visible) return;
    running = Promise.resolve().then(initialize).then(value => { complete = true; return value; })
      .catch(() => { ctx.logger?.warn('模型分组初始化未完成，配置保持原样；重新打开模型设置后可重试。'); })
      .finally(() => { running = undefined; });
    return running;
  }
  if (typeof ctx.on === 'function') {
    removers.push(ctx.on('internal/status', attempt));
    removers.push(ctx.on('settings/document-updated', attempt));
  }
  queueMicrotask(attempt);
  ctx.effect(() => () => { stopped = true; for (const remove of removers) remove?.(); });
  return { attempt, get complete() { return complete; } };
}
