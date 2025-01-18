const request = require('supertest');
const path = require('path');
const fs = require('fs');
const { BaseHttpServer } = require('../../src/http/BaseHttpServer');

jest.spyOn(process, 'cwd').mockReturnValue(__dirname); // Mock process.cwd

describe('JSX Integration Test', () => {
    it('should', () => expect(true).toBe(true));

    let testFiles = [];
    const publicPath = path.join(process.cwd(), 'test-public');

    // Dynamically load JSX and expected HTML files from the test directory
    const files = fs.readdirSync(publicPath);

    testFiles = files
        .filter(file => file.endsWith('-test.jsx'))
        .map(jsxFile => {
            const expectedFile = jsxFile.replace('-test.jsx', '-expected.html');
            const expectedPath = path.join(publicPath, expectedFile);

            if (!fs.existsSync(expectedPath)) {
                throw new Error(`Missing required expected HTML file: ${expectedFile}`);
            }

            return { jsx: jsxFile, expected: expectedFile };
        });

    if (testFiles.length === 0) {
        throw new Error('No test files found. Ensure the directory contains valid test and expected files.');
    }

    const normalizeHandlerIds = (html) => {
        return html
            .replace(/handler_[a-z0-9]+/g, 'handler_xxxxxx') // Normalize handler IDs
            .replace(/<script>\s*([\s\S]*?)\s*<\/script>/g, '<script>$1</script>') // Normalize script spacing
            .replace(/\s+/g, ' ') // Collapse multiple spaces into one
            .trim(); // Remove leading and trailing whitespace
    };

    testFiles.forEach(({ jsx, expected }) => {
        test(`should render ${jsx} correctly`, async () => {
            const serverInstance = new BaseHttpServer({ enableJSXRendering: true, publicPaths: ['./test-public'] });
            const app = serverInstance.app;

            const res = await request(app).get(`/${jsx}`);
            expect(res.status).toBe(200);

            const expectedContent = fs.readFileSync(path.join(publicPath, expected), 'utf8');

            // Normalize dynamic handler IDs for fair comparison
            const normalizedReceived = normalizeHandlerIds(res.text);
            const normalizedExpected = normalizeHandlerIds(expectedContent.trim());

            expect(normalizedReceived).toMatch(normalizedExpected);
        });
    });
});
