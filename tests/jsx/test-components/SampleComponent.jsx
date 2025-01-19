
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
            