export {};

declare global {
    const headers: { hash: string; label: string }[];
}

console.log({ headers });
