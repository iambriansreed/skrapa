const btn = document.getElementById('counter') as HTMLButtonElement;
let count = 0;
btn?.addEventListener('click', () => {
    count++;
    btn.textContent = `count is ${count}`;
});

console.log('/client.ts loaded');
