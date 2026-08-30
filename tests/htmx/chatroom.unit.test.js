const { createChatroomPage } = require('../../examples/live-html/chatroom');

describe('canonical chat component data model without mocks', () => {
    test('normalizes identities, validates input, and keeps bounded messages with stable IDs', () => {
        const Page = createChatroomPage();
        const alice = new Page().chat;
        const bob = new Page().chat;
        expect(alice.send({ message: 'before joining' })).toBe(false);
        expect(alice.join({ name: ' Alice ' })).toBe(true);
        expect(alice.displayName).toBe('Alice');
        expect(bob.join({ name: 'ALICE' })).toBe(false);
        expect(bob.feedback).toContain('already in use');
        expect(bob.join({ name: 'Bob' })).toBe(true);
        expect(alice.members).toEqual(['Alice', 'Bob']);
        for (const message of [undefined, 42, '', ' ', 'x'.repeat(501), 'hidden\u200btext']) {
            expect(alice.send({ message })).toBe(false);
        }
        for (let index = 0; index < 101; index++) expect(alice.send({ message: `message-${index}` })).toBe(true);
        expect(alice.messages).toBe(bob.messages);
        expect(bob.messages).toHaveLength(100);
        expect(bob.messages[0]).toEqual({ id: 2, sender: 'Alice', text: 'message-1' });
        expect(bob.messages.at(-1).id).toBe(101);
        expect(alice.join({ name: 'New identity' })).toBe(false);
    });

    test('disconnect removes presence but reserves identity until explicit leave or disposal', () => {
        const Page = createChatroomPage();
        const alice = new Page().chat;
        const bob = new Page().chat;
        expect(alice.join({ name: undefined })).toBe(false);
        expect(alice.feedback).toContain('must be text');
        expect(alice.join({ name: 'x'.repeat(41) })).toBe(false);
        expect(alice.join({ name: 'hidden\u200bname' })).toBe(false);
        alice.join({ name: 'Alice' });
        bob.join({ name: 'Bob' });
        alice.disconnected();
        alice.disconnected();
        expect(bob.members).toEqual(['Bob']);
        expect(alice.send({ message: 'while offline' })).toBe(false);
        const replacement = new Page().chat;
        expect(replacement.join({ name: 'Alice' })).toBe(false);
        alice.connected();
        expect(bob.members).toEqual(['Bob', 'Alice']);
        alice.leave();
        alice.disposed();
        expect(alice.displayName).toBe('');
        expect(alice.messages).toEqual([]);
        expect(replacement.join({ name: 'Alice' })).toBe(true);
        replacement.disposed();
        replacement.disposed();
        expect(bob.members).toEqual(['Bob']);
        new Page().chat.connected();
    });
});
