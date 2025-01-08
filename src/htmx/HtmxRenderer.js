const fs = require('fs');
const vm = require('vm');
const path = require('path');

class HtmxRenderer {
    /**
     * Render an .htmx file as JavaScript with embedded print statements.
     * @param {string} filePath - Path to the .htmx file.
     * @returns {string} Rendered HTML string with normalized whitespace.
     */
    static render(filePath) {
        if (!fs.existsSync(filePath)) {
            throw new Error(`Template file not found: ${filePath}`);
        }

        let output = '';
        const templateContent = fs.readFileSync(filePath, 'utf-8');

        // Transform <@ ... @/> blocks into print() calls
        const transformedTemplate = templateContent.replace(
            /<@>([\s\S]*?)<@\/>/g,
            (_, content) => `print(\`${content.replace(/{{\s*(.*?)\s*}}/g, '${$1}')}\`);`
        );

        // Wrap the script in an IIFE
        const wrappedScript = `
        (() => {
            const print = (html) => output += html;
            ${transformedTemplate}
            return output;
        })();
        `;

        // Create a custom require function that resolves paths relative to the template
        const customRequire = (modulePath) => {
            const absolutePath = path.resolve(path.dirname(filePath), modulePath);
            return require(absolutePath);
        };

        // Execute the script in a sandbox
        const script = new vm.Script(wrappedScript);
        const sandbox = {
            output: '',
            require: customRequire, // Add custom require
            __dirname: path.dirname(filePath),
            __filename: filePath,
        };
        vm.createContext(sandbox);

        // Get the rendered output
        let result = script.runInContext(sandbox);

        // Normalize spaces but preserve those in content
        result = result
            .replace(/>\s+</g, '><')       // Remove spaces between tags
            .replace(/\s+/g, ' ')         // Collapse multiple spaces to one
            .replace(/>\s+/g, '>')        // Remove spaces after tags
            .replace(/\s+</g, '<')        // Remove spaces before tags
            .trim();                      // Trim leading and trailing spaces

        return result;
    }
}

module.exports = HtmxRenderer;
