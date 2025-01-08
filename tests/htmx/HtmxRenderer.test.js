const fs = require('fs');
const path = require('path');
const HtmxRenderer = require('../../src/htmx/HtmxRenderer');

describe('HtmxRenderer', () => {
    const testDir = path.join(__dirname, 'tests');
    const testFiles = fs.readdirSync(testDir)
        .filter((file) => /^\d+\.htmx$/.test(file)) // Match files like "1.htmx", "2.htmx", etc.
        .sort((a, b) => parseInt(a) - parseInt(b)); // Sort numerically

    testFiles.forEach((testFile) => {
        const testNumber = path.basename(testFile, '.htmx');
        const templatePath = path.join(testDir, testFile);
        const expectedPath = path.join(testDir, `${testNumber}-expected.html`);

        it(`should correctly render template ${testNumber}`, () => {
            const expectedContent = fs.readFileSync(expectedPath, 'utf8');
            const result = HtmxRenderer.render(templatePath);

            expect(result.trim()).toBe(expectedContent.trim());
        });
    });

    it('should throw an error if the template file does not exist', () => {
        expect(() => {
            HtmxRenderer.render('nonexistent.htmx');
        }).toThrow('Template file not found: nonexistent.htmx');
    });
});
