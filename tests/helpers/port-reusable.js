'use strict';

const net = require('node:net');
const { waitFor } = require('../../scripts/realtime-harness');

async function assertPortReusable(port) {
    const probe = net.createServer();
    probe.listen(port, '127.0.0.1');
    await waitFor(probe, 'listening');
    await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
}

module.exports = { assertPortReusable };
