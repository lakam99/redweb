import { ERROR_CODES, ProtocolClient, ProtocolEnvelope } from '../../client';

const socket = { send(_data: string) {} };
const client = new ProtocolClient(socket, '1');
const envelope: ProtocolEnvelope<{ x: number }> = client.envelope('move', { x: 1 }, {
    requestId: 'request',
    sequence: 1,
});
client.send('move', envelope.payload);
const parsed = client.parse<{ x: number }>(JSON.stringify(envelope));
client.parse(new ArrayBuffer(0));
void parsed.type;
void ERROR_CODES.INVALID_MESSAGE;
