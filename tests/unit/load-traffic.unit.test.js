'use strict';

const { EventEmitter } = require('node:events');
const { LoadMeasurement } = require('../../scripts/lib/LoadMeasurement');
const { measureLoadTraffic } = require('../../scripts/lib/measureLoadTraffic');

// Explicit unit peers exercise synchronous/error ordering. The integration
// counterpart uses real WebSockets, invalid frames and the real 30s deadline.
test.each(['send-throw', 'error-then-message', 'duplicate-final', 'probe-error', 'wire-and-probe-error', 'closed-after-completion'])
('traffic listener ownership survives %s', async outcome => {
    const measurement = new LoadMeasurement({ REDWEB_LOAD_CLIENTS: '2', REDWEB_LOAD_MESSAGES: '1' });
    const primary = new Error(outcome);
    const clients = [new EventEmitter(), new EventEmitter()];
    const afterMessages = jest.fn(async () => {
        if (outcome === 'probe-error') throw primary;
        if (outcome === 'wire-and-probe-error') {
            clients[0].emit('error', primary);
            throw new Error('unit probe rejection');
        }
        clients.forEach(client => client.emit('close'));
        return true;
    });
    clients.forEach((client, index) => {
        client.send = jest.fn(raw => {
            if (outcome === 'send-throw') throw primary;
            if (outcome === 'error-then-message') {
                client.emit('error', primary);
                client.emit('error', new Error('secondary'));
            }
            const { id } = JSON.parse(raw);
            client.emit('message', JSON.stringify({ id }));
            if (outcome === 'duplicate-final' && index === 1) client.emit('message', JSON.stringify({ id }));
        });
    });
    const operation = measureLoadTraffic(clients, measurement, afterMessages);
    if (outcome === 'closed-after-completion') {
        await expect(operation).resolves.toMatchObject({ messages: 2, slowConsumerContained: true });
    } else if (outcome === 'duplicate-final') {
        await expect(operation).rejects.toThrow('duplicate');
        expect(afterMessages).not.toHaveBeenCalled();
    } else if (outcome === 'wire-and-probe-error') {
        const failure = await operation.catch(error => error);
        expect(failure).toBeInstanceOf(AggregateError);
        expect(failure.cause).toBe(primary);
        expect(failure.errors[0]).toBe(primary);
        expect(failure.errors[1].message).toBe('unit probe rejection');
    } else await expect(operation).rejects.toBe(primary);
    if (['send-throw', 'error-then-message'].includes(outcome)) {
        expect(clients[1].send).not.toHaveBeenCalled();
        expect(afterMessages).not.toHaveBeenCalled();
    }
    for (const client of clients) for (const event of ['message', 'error', 'close']) expect(client.listenerCount(event)).toBe(0);
});
