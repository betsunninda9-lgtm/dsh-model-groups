import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

// Evaluate the actual pure positioning helper; no copied layout algorithm.
const source = readFileSync(new URL('../src/model-select.js', import.meta.url), 'utf8');
const helper = source.slice(source.indexOf('function layoutModelFlyouts('), source.indexOf('function ModelSelect('));
const layout = vm.runInNewContext(`${helper}\nlayoutModelFlyouts`);
function assertSeparate(panels, width, height) {
  for (const panel of panels) {
    assert.ok(panel.left >= 0 && panel.top >= 0);
    assert.ok(panel.left + panel.width <= width + 1e-8);
    assert.ok(panel.top + panel.height <= height + 1e-8);
    assert.equal(panel.minWidth, 0, 'native menu min-width must not defeat narrow columns');
  }
  const sorted = [...panels].sort((a, b) => a.left - b.left);
  for (let i = 1; i < sorted.length; i++) assert.ok(sorted[i - 1].left + sorted[i - 1].width <= sorted[i].left + 1e-8, 'ancestor and descendant must not overlap');
}

test('wide viewports preserve full-width cards and all three levels without covering ancestors', () => {
  const rect = { left: 750, top: 100, width: 280, height: 350 };
  const panels = layout(rect, 1280, 800, 3);
  assertSeparate(panels, 1280, 800);
  assert.ok(panels.every(panel => panel.width === 280 && panel.height === 350));
  assert.equal(panels[0].left, rect.left);
  assert.equal(panels[1].left, 470);
  assert.equal(panels[2].left, 190);
});

test('near the left edge a full-size cascade opens to the right', () => {
  const panels = layout({ left: 12, top: 50, width: 280, height: 300 }, 1200, 800, 3);
  assertSeparate(panels, 1200, 800);
  assert.equal(panels[0].left, 12);
  assert.equal(panels[1].left, 292);
  assert.equal(panels[2].left, 572);
});

test('phone and tablet widths keep two and three cards separately visible within viewport', () => {
  for (const width of [240, 320, 360, 390, 480, 600, 768]) {
    for (const count of [2, 3]) {
      const panels = layout({ left: 12, top: 600, width: Math.min(360, width - 24), height: 350 }, width, 700, count);
      assert.equal(panels.length, count);
      assertSeparate(panels, width, 700);
      assert.ok(panels.every(panel => panel.width >= Math.min(360, width - 24, (width - 24) / count) - 1e-8));
    }
  }
});

test('opening a third column repositions existing columns and closing restores their larger widths', () => {
  const rect = { left: 30, top: 30, width: 300, height: 350 };
  const two = layout(rect, 390, 700, 2);
  const three = layout(rect, 390, 700, 3);
  assertSeparate(two, 390, 700);
  assertSeparate(three, 390, 700);
  assert.equal(two[0].width, 183);
  assert.equal(three[0].width, 122);
  assert.deepEqual(layout(rect, 390, 700, 2), two);
});

test('short viewports clamp card height and vertical position', () => {
  const panels = layout({ left: 400, top: 700, width: 280, height: 500 }, 900, 240, 3);
  assertSeparate(panels, 900, 240);
  assert.ok(panels.every(panel => panel.height === 216 && panel.top === 12));
});
