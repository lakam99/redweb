const ComponentFive = require('./5-test.jsx');
const ComponentThree = require('./3-test.jsx');
const { test_fn, test_num } = require('./extra-import.js');

function ComponentSix() {
    const items = ['Apple', 'Banana', 'Cherry'];
    return (
        <div>
            <ComponentFive></ComponentFive>
            <h1>Component Six</h1>
            <ComponentThree></ComponentThree>
            {test_num} {test_fn()}
        </div>
    );
}

module.exports = ComponentSix;
