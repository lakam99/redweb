'use strict';

module.exports = `
:host { position: fixed; inset: auto 1rem 1rem auto; z-index: 2147483647; max-width: min(28rem, calc(100vw - 2rem)); font: 14px/1.5 system-ui, sans-serif; }
aside { background: #17202b; color: #fff; border: 1px solid #718198; border-radius: 8px; padding: 16px; box-shadow: 0 4px 24px #0006; }
p { margin: 0 0 12px; }
button { background: #fff; color: #17202b; border: 2px solid #fff; border-radius: 4px; font: inherit; padding: 6px 12px; cursor: pointer; }
button:focus-visible { outline: 3px solid #6edcff; outline-offset: 3px; }
`;
