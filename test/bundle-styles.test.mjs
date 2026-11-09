// Regression: the client module system memoizes exports, so a disposed and
// re-applied plugin never re-runs its module body. Styles must therefore be
// (re)installed by apply(), not at module materialization time.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8');

function mount() {
  const styles = [];
  const document = {
    head: {
      appendChild: (element) => {
        styles.push(element);
      },
    },
    body: { appendChild: () => {} },
    createElement: () => {
      const element = { dataset: {}, textContent: '' };
      element.remove = () => {
        const index = styles.indexOf(element);
        if (index !== -1) styles.splice(index, 1);
      };
      return element;
    },
    querySelector: (selector) => {
      const match = /^style\[data-plugin-css="(.*)"\]$/.exec(selector);
      return match === null ? null : (styles.find((style) => style.dataset.pluginCss === match[1]) ?? null);
    },
    querySelectorAll: (selector) => /^style\[data-plugin="(.*)"\]$/.exec(selector) === null ? [] : styles.filter((style) => style.dataset.plugin === /^style\[data-plugin="(.*)"\]$/.exec(selector)[1]),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const window = { addEventListener: () => {}, removeEventListener: () => {} };
  let captured;
  const sandbox = {
    window,
    document,
    console,
    setTimeout,
    clearTimeout,
    HTMLElement: class {},
    HTMLButtonElement: class {},
    HTMLInputElement: class {},
    ResizeObserver: class {
      observe() {}
      disconnect() {}
    },
  };
  sandbox.globalThis = sandbox;
  window.__ModuleLoader__ = {
    load: (value) => {
      captured = value;
    },
  };
  vm.runInNewContext(source, sandbox);
  assert.ok(captured !== undefined, 'client bundle must register through the module loader');
  const plugin = captured.factory((id) => {
    if (id === 'react') return { useSyncExternalStore: () => ({}), useState: () => [null, () => {}], Component: class {} };
    return {};
  });
  return { plugin, styles };
}

test('styles survive a dispose/re-apply cycle on a memoized module', () => {
  const { plugin, styles } = mount();
  const disposers = [];
  const ctx = {
    on: (event, callback) => {
      if (event === 'dispose') disposers.push(callback);
    },
    slots: { inject: () => {}, register: () => {} },
  };
  plugin.apply(ctx);
  assert.equal(styles.length, 2, 'the first apply installs both stylesheets');
  for (const dispose of disposers) dispose();
  assert.equal(styles.length, 0, 'disposal removes the plugin stylesheets');
  plugin.apply(ctx);
  assert.equal(styles.length, 2, 'a re-applied memoized module restores them');
});
