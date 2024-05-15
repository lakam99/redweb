# RedWeb

RedWeb is a simple and flexible Node.js framework built on top of Express.js. It allows you to quickly set up a web server with customizable options, including serving static files and defining custom API endpoints.

## Installation

To install RedWeb, use npm:

```bash
npm install redweb
```

## Usage

### Basic Example

To get started with RedWeb, simply initialize your RedWeb instance with the default options:

```javascript
const { RedWeb } = require('redweb');

const app = new RedWeb();
```

### Custom Configuration

You can also configure RedWeb according to your needs:

```javascript
const { RedWeb, METHODS } = require('redweb');

const services = [
    {
        serviceName: '/submit-form',
        method: METHODS.POST,
        function: (req, res) => {
            const { name, email, message } = req.body;
            if (!name || !email || !message) {
                return res.status(400).json({ error: 'All fields are required' });
            }
            // Implement your logic here
            res.status(200).json({ success: 'Form submitted successfully' });
        }
    }
];

const options = {
    port: 3000,
    publicPaths: [
        './pages/my_public_html',
        './content/my_public_images',
        './styles/styles.css'
    ],
    encoding: 'urlencoded',
    services: services
};

const app = new RedWeb(options);
```

## Options

The `RedWeb` constructor accepts an options object with the following properties:

- **port**: The port number to bind the server (default: `80`).
- **bind**: The bind address for the server (default: `0.0.0.0`).
- **publicPaths**: An array of paths to serve static files from (default: `['./public']`).
- **services**: An array of services with their endpoints and handlers (default: `[]`).
- **listenCallback**: A callback function to execute once the server starts listening (default: `undefined`).
- **encoding**: The encoding type for the request bodies. It can be either `'json'` or `'urlencoded'` (default: `'json'`).

### Example Options Object

```javascript
const options = {
    port: 3000,
    bind: '127.0.0.1',
    publicPaths: ['./public', './assets'],
    services: [
        {
            serviceName: '/api/data',
            method: METHODS.GET,
            function: (req, res) => {
                res.json({ message: 'Hello, world!' });
            }
        }
    ],
    listenCallback: () => console.log('Server is running...'),
    encoding: 'json'
};
```

## Methods

RedWeb provides a `METHODS` object that contains the HTTP methods you can use for defining services:

- `METHODS.POST` - 'post'
- `METHODS.GET` - 'get'

## License

MIT License