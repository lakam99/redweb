function ComponentThree() {
    const list = ['Item A', 'Item B', 'Item C'];
    return (
        <ul>
            {list.map((item, index) => (
                <li key={index}>{item}</li>
            ))}
        </ul>
    );
}

module.exports = ComponentThree;