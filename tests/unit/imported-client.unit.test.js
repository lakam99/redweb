'use strict';

const clientProtocolCases = require('../fixtures/client-protocol-cases');

test('imported client public protocol units validate envelopes, errors, URLs and options without opening sockets', () => {
    expect(clientProtocolCases(require('redweb-client')).assertions).toBeGreaterThan(50);
});
