'use strict';

const { main } = require('../../scripts/verify-browser-coverage');

// Actual Redweb HTTP/WebSockets and Chromium, with the canonical plain and
// instrumented frontend cases. No browser, transport or filesystem mocks.
test('browser supplements run the canonical native lifecycle and frame assertions', async () => {
    await main('runtime');
}, 300000);
