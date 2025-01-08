class ListComponent {
    constructor(data) {
        this.data = data;
    }

    render() {
        return this.data.map((e) => `<p>Entry: ${e}</p>`).join('');
    }
}

module.exports = ListComponent;
