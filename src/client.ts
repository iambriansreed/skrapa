console.info('Hello from client.ts!');

const json = document.querySelector<HTMLElement>('[data-object]')?.dataset.object;

console.log(json);

console.log('Parsed JSON from data-object:', json ? JSON.parse(json) : null);
