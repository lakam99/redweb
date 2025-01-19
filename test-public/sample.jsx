import { OtherComponent } from "./other.jsx";

function ComponentSeven() {
    const handleClick = () => alert('Button clicked!');
    const handleMouseOver = () => console.log('Mouse over!');

    return (
        <div>
            <OtherComponent></OtherComponent>
            <h1>Component Seven</h1>
            <button onClick={handleClick}>Click Me</button>
            <p onMouseOver={handleMouseOver}>Hover over this text</p>
        </div>
    );
}

module.exports = ComponentSeven;
