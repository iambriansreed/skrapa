document.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code:not([data-no-copy])');
    if (!code) return;

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    pre.appendChild(btn);

    btn.addEventListener('click', () => {
        navigator.clipboard.writeText(code.textContent ?? '').then(() => {
            btn.textContent = 'Copied!';
            setTimeout(() => (btn.textContent = 'Copy'), 2000);
        });
    });
});
