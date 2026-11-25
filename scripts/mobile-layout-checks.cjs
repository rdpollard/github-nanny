const assert = require('node:assert/strict');

module.exports = async function checkMobileLayout(page, origin) {
  const runs = ['in_progress', 'queued', 'waiting'].map((status, index) => ({
    id: index + 1, attempt: 1, repository: 'example/project', workflow: `Layout CI ${index + 1}`,
    branch: 'main', status, url: `https://github.com/example/project/actions/runs/${index + 1}/attempts/1`,
    startedAt: '2026-11-24T12:00:00Z',
  }));
  let phase = 'busy';
  await page.route(`${origin}/api/status`, route => route.fulfill({ json: {
    phase, connected: true, repositoryCount: 4, checkedAt: phase === 'unknown' ? null : new Date().toISOString(),
    message: 'Layout preview with sample activity.', runs: phase === 'busy' ? runs : [],
  } }));
  const group = page.getByRole('group', { name: 'Filter active runs' });
  const buttons = group.getByRole('button');
  async function geometry(expectRow) {
    const boxes = await buttons.evaluateAll(nodes => nodes.map(node => {
      const box = node.getBoundingClientRect();
      // Text ink can extend a pixel beyond its line box at large font sizes;
      // check the actual padded button boundary rather than treating that as clipping.
      const clipped = [...node.querySelectorAll('p')].some(text => {
        const rect = text.getBoundingClientRect();
        return rect.x + text.scrollWidth > box.right - 1 || rect.y + text.scrollHeight > box.bottom - 1;
      });
      return { x: box.x, y: box.y, width: box.width, height: box.height, clipped, text: [...node.querySelectorAll('p')].map(p => ({ text: p.textContent, width: p.clientWidth, scroll: p.scrollWidth, height: p.clientHeight, scrollHeight: p.scrollHeight, wrap: getComputedStyle(p).overflowWrap })) };
    }));
    assert.equal(boxes.length, 3);
    assert.ok(boxes.every(box => box.height >= 44 && !box.clipped), `Touch targets and complete text must remain usable: ${JSON.stringify(boxes)}`);
    if (expectRow) {
      assert.ok(boxes.every(box => Math.abs(box.y - boxes[0].y) < 1), 'Normal text must keep all three filters in one row');
      assert.ok(boxes.every(box => Math.abs(box.width - boxes[0].width) < 1), 'Columns should have equal widths');
    }
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false, 'No page-level horizontal overflow');
  }
  try {
    await page.goto(origin);
    await page.getByRole('heading', { name: 'GitHub is busy' }).waitFor();
    assert.equal(await page.getByText('A little less checking. A little more doing.', { exact: true }).count(), 0);
    assert.equal(await group.locator('svg').count(), 0);
    for (const width of [320, 360, 390, 1440]) {
      await page.setViewportSize({ width, height: 844 });
      await geometry(true);
    }
    await page.setViewportSize({ width: 390, height: 844 });
    const activity = await page.getByRole('heading', { name: 'Repositories with activity' }).boundingBox();
    assert.ok(activity.y < 500, 'Activity heading should be high on a typical phone viewport');
    assert.ok((await page.getByRole('listitem').first().boundingBox()).y < 844, 'First activity should be visible without scrolling in this fixture');
    const running = group.getByRole('button', { name: 'Running', exact: false });
    await running.focus(); await page.keyboard.press('Space');
    assert.equal(await running.getAttribute('aria-pressed'), 'true');
    assert.equal(await running.evaluate(node => getComputedStyle(node).outlineStyle), 'solid');
    assert.equal(await page.getByRole('listitem').count(), 1);
    await group.getByRole('button', { name: 'Queued / waiting', exact: false }).click();
    assert.equal(await page.getByRole('listitem').count(), 2);
    await group.getByRole('button', { name: 'Active runs', exact: false }).click();
    assert.equal(await page.getByRole('listitem').count(), 3);
    // Stress the rendered count boxes without fabricating thousands of run rows.
    for (const count of ['9999', '10000', '123456789012345']) {
      await buttons.locator('p:last-child').evaluateAll((nodes, count) => nodes.forEach(node => { node.textContent = count; }), count);
      await page.setViewportSize({ width: 320, height: 844 }); await geometry(true);
    }
    for (const dark of [true, false]) {
      await page.getByRole('button', { name: dark ? 'Use dark theme' : 'Use light theme', exact: true }).click();
      const ratios = await buttons.evaluateAll(nodes => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d');
        const luminance = color => {
          ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
          const rgb = ctx.getImageData(0, 0, 1, 1).data;
          const linear = [...rgb].slice(0, 3).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; });
          return linear[0] * .2126 + linear[1] * .7152 + linear[2] * .0722;
        };
        return nodes.map(node => {
          const a = luminance(getComputedStyle(node).backgroundColor), b = luminance(getComputedStyle(node.querySelector('p')).color);
          return (Math.max(a, b) + .05) / (Math.min(a, b) + .05);
        });
      });
      assert.ok(ratios.every(ratio => ratio >= 4.5), 'Small labels need adequate contrast in either theme');
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await geometry(false);
    await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); });
    await page.getByRole('button', { name: 'Compact layout', exact: true }).click();
    await geometry(true);
    await page.getByRole('button', { name: 'Expand layout', exact: true }).click();
    for (const next of ['idle', 'unknown']) {
      phase = next; await page.reload();
      await page.getByRole('heading', { name: next === 'idle' ? 'GitHub is idle' : 'Status unavailable', exact: true }).waitFor();
      for (const count of await buttons.locator('p:last-child').allTextContents()) assert.equal(count, next === 'idle' ? '0' : '—');
      await geometry(true);
    }
    await page.evaluate(() => { document.documentElement.style.fontSize = '200%'; });
    await geometry(false);
  } finally {
    await page.evaluate(() => { document.documentElement.style.removeProperty('font-size'); });
    await page.unroute(`${origin}/api/status`);
    await page.setViewportSize({ width: 1440, height: 1100 });
  }
};
