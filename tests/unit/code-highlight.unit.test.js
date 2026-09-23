const { codeBlock, highlightCode, html } = require('../..');

describe('built-in code highlighting', () => {
    test('highlights nested rw-* actions without turning strings or comments into references', () => {
        const markup = highlightCode('<button rw-click={Move.with({ cell, revision: 2, label: "{safe}" })}>Go</button>\n'
            + '<form rw-submit={Join}></form>', 'tsx').toString();
        for (const name of ['Move', 'with', 'cell', 'revision', 'label', 'Join']) {
            expect(markup).toContain(`<span class="token-reference">${name}</span>`);
        }
        expect(markup).toContain('<span class="token-number">2</span>');
        expect(markup).toContain('<span class="token-string">&quot;{safe}&quot;</span>');
        expect(markup).not.toContain('<button');
        expect(highlightCode('<button rw-click = { Run }>', 'tsx').toString())
            .toContain('<span class="token-reference">Run</span>');
    });

    test('keeps ordinary identifiers and text-only languages unstyled and escaped', () => {
        expect(highlightCode('plain', 'text').toString()).toBe('plain');
        expect(highlightCode('<img src=x>', 'text').toString()).toBe('&lt;img src=x&gt;');
        expect(highlightCode('<button title="rw-click={Ignored}">{plain}</button>', 'tsx').toString())
            .not.toContain('token-reference');
        expect(highlightCode('', 'js').toString()).toBe('');
        expect(codeBlock(html`<b>ready</b>`, { language: 'tsx' }).toString()).toContain('<b>ready</b>');
    });

    test('highlights language tokens while respecting comments, escapes and incomplete input', () => {
        const markup = highlightCode('const ready = true; let x = null; // note\n'
            + '/* more */ "escaped \\" quote" `template` 0xff 3.5e+2', 'javascript').toString();
        for (const kind of ['keyword', 'literal', 'comment', 'string', 'number']) {
            expect(markup).toContain(`class="token-${kind}"`);
        }
        expect(highlightCode('// end', 'js').toString()).toContain('token-comment');
        expect(highlightCode('/* end', 'ts').toString()).toContain('token-comment');
        expect(highlightCode('"end', 'typescript').toString()).toContain('token-string');
        expect(highlightCode('rw-click={Run({ x: 1 })} outside', 'tsx').toString())
            .not.toContain('<span class="token-reference">outside</span>');
    });
});
