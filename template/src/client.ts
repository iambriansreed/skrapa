let count = 0;

const btn = document.getElementById('counter') as HTMLButtonElement;

btn?.addEventListener('click', () => {
    count++;
    btn.textContent = `count is ${count}`;
});

console.log('/client.ts loaded');
