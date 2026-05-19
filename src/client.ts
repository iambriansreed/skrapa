document.querySelectorAll('pre').forEach((pre) => {
    const code = pre.querySelector('code:not([data-no-copy])');
    if (!code) return;

    const btn = document.createElement('button');
    btn.className = 'copy-btn';
    btn.textContent = 'Copy';
    pre.appendChild(btn);

    const doCopy = () => {
        navigator.clipboard.writeText(code.textContent ?? '').then(() => {
            btn.textContent = 'Copied!';
            btn.classList.add('copied');
            setTimeout(() => {
                btn.textContent = 'Copy';
                btn.classList.remove('copied');
            }, 2000);
        });
    };

    btn.addEventListener('click', (e) => { e.stopPropagation(); doCopy(); });
    pre.addEventListener('click', doCopy);
});
