class RedWebHtmxComponent {
    constructor(props = {}) {
        this.props = props;
    }

    render() {
        throw new Error('Render method must be implemented in derived components');
    }
}

module.exports = RedWebHtmxComponent;
