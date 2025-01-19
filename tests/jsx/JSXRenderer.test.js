const { JSDOM } = require('jsdom');
const path = require('path');
const fs = require('fs');
const { render, createElement } = require('../../src/jsx/JSXRenderer');

describe('JSXRenderer', () => {
    const testJSXPath = path.join(__dirname, 'test-components');

    beforeAll(() => {
        if (!fs.existsSync(testJSXPath)) {
            fs.mkdirSync(testJSXPath);
        }

        // Create sample JSX files for testing
        fs.writeFileSync(
            path.join(testJSXPath, 'SampleComponent.jsx'),
            `
            function SampleComponent() {
                return (
                    <div>
                        <h1>Sample Component</h1>
                        <button onClick={() => console.log('Button clicked!')}>Click Me</button>
                        <p onMouseOver={() => console.log('Mouse over!')}>Hover over this text</p>
                    </div>
                );
            }

            module.exports = SampleComponent;
            `
        );
    });

    // afterAll(() => {
    //     // Clean up test JSX files
    //     fs.rmSync(testJSXPath, { recursive: true, force: true });
    // });

    it('should render a simple JSX component', () => {
        const renderedHTML = render(path.join(testJSXPath, 'SampleComponent.jsx'));

        const dom = new JSDOM(renderedHTML);
        const { document } = dom.window;

        const h1 = document.querySelector('h1');
        expect(h1).not.toBeNull();
        expect(h1.textContent).toBe('Sample Component');

        const button = document.querySelector('button');
        expect(button).not.toBeNull();
        expect(button.textContent).toBe('Click Me');

        const paragraph = document.querySelector('p');
        expect(paragraph).not.toBeNull();
        expect(paragraph.textContent).toBe('Hover over this text');
    });

    it('should attach event handlers to elements', () => {
        const renderedHTML = render(path.join(testJSXPath, 'SampleComponent.jsx'));

        const dom = new JSDOM(renderedHTML);
        const { document } = dom.window;

        // Verify event handler data attributes
        const button = document.querySelector('button');
        expect(button.hasAttribute('data-event-click')).toBe(true);

        const paragraph = document.querySelector('p');
        expect(paragraph.hasAttribute('data-event-mouseover')).toBe(true);

        // Verify event handler script generation
        const scripts = document.querySelectorAll('script');
        expect(scripts.length).toBe(1);

        const scriptContent = scripts[0].textContent;
        expect(scriptContent).toContain("addEventListener('click'");
        expect(scriptContent).toContain("addEventListener('mouseover'");
    });

    it('should throw an error for invalid JSX files', () => {
        const invalidFilePath = path.join(testJSXPath, 'InvalidComponent.jsx');
        fs.writeFileSync(invalidFilePath, 'Invalid content');

        expect(() => render(invalidFilePath)).toThrowError();

        fs.unlinkSync(invalidFilePath);
    });
});
