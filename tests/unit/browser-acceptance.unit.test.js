'use strict';

const { BrowserAcceptance } = require('../../scripts/lib/BrowserAcceptance');

test('browser acceptance shares page opening, bounded evaluation, readiness and CSS assertions', async () => {
    const calls = [];
    const page = { evaluate: async expression => {
        calls.push(['evaluate', expression]);
        return expression.includes('getComputedStyle') ? 'rgb(1, 2, 3)' : true;
    } };
    const pages = { open: async (port, url) => { calls.push(['open', port, url]); return page; } };
    const bounded = async (promise, label) => { calls.push(['bounded', label]); return promise; };
    const eventual = (expression, label) => `eventual(${expression},${label})`;
    const acceptance = new BrowserAcceptance({ pages, debugPort: 9222, eventual, bounded });
    expect(await acceptance.open('http://127.0.0.1:8181', '/about')).toBe(page);
    await expect(acceptance.evaluate(page, 'true')).resolves.toBe(true);
    await expect(acceptance.wait(page, 'ready', 'unit readiness')).resolves.toBe(true);
    await expect(acceptance.style(page, '.card', 'color', 'rgb(1, 2, 3)')).resolves.toBeUndefined();
    expect(calls).toContainEqual(['open', 9222, 'http://127.0.0.1:8181/about']);
    expect(calls).toContainEqual(['bounded', 'unit readiness']);
});

test('browser acceptance rejects a missing stylesheet result', async () => {
    const page = { evaluate: async () => 'rgb(9, 9, 9)' };
    const acceptance = new BrowserAcceptance({ pages: {}, debugPort: 1, eventual: value => value,
        bounded: promise => promise });
    await expect(acceptance.style(page, 'button', 'backgroundColor', 'rgb(1, 2, 3)'))
        .rejects.toThrow('button backgroundColor was not applied');
});
