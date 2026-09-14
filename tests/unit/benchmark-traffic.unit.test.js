'use strict';

const { EventEmitter } = require('node:events');
const { BenchmarkBatch } = require('../../scripts/lib/BenchmarkBatch');
const { measureBenchmarkBatch } = require('../../scripts/lib/measureBenchmarkBatch');

// Explicit synchronous unit peers supplement the actual native-network cases.
test.each(['send-throw', 'error-message', 'duplicate-final', 'close-after-completion'])
('benchmark traffic handles %s without leaked listeners', async outcome => {
    const peer = new EventEmitter();
    const primary = new Error('unit primary');
    peer.send = raw => {
        if (outcome === 'send-throw') throw primary;
        if (outcome === 'error-message') {
            peer.emit('error', primary); peer.emit('error', new Error('unit secondary'));
        }
        const reply = JSON.stringify({ id: JSON.parse(raw).id });
        peer.emit('message', reply);
        if (outcome === 'duplicate-final') peer.emit('message', reply);
        if (outcome === 'close-after-completion') peer.emit('close');
    };
    const operation = measureBenchmarkBatch(peer, new BenchmarkBatch(1, 1, true));
    if (outcome === 'close-after-completion') await expect(operation).resolves.toMatchObject({ sent: 1, received: 1 });
    else if (outcome === 'duplicate-final') await expect(operation).rejects.toThrow('duplicate');
    else await expect(operation).rejects.toBe(primary);
    for (const event of ['message', 'error', 'close']) expect(peer.listenerCount(event)).toBe(0);
});
