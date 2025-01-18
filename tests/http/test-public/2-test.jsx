function ComponentTwo() {
    const date = new Date(2025, 0, 1).toLocaleDateString();
    return <div>Today's date is {date}.</div>;
}

module.exports = ComponentTwo;
