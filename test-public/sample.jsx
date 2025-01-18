const OtherComponent = require('./other.jsx');

function SampleComponent() {
    return (
    <div>
        <OtherComponent></OtherComponent>
        Hello from SampleComponent!
            <p>5 + 5 = {5 + 5}</p>
            <p>10 + 5 = {10 + 5}</p>
    </div>
    )
}


module.exports = SampleComponent;