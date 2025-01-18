module.exports = () => {
    const title = "Dynamic Page";
    const message = "This page was dynamically rendered!";

    return `
        <html>
            <head>
                <title>${title}</title>
            </head>
            <body>
                <h1>${title}</h1>
                <p>${message}</p>
            </body>
        </html>
    `;
};
