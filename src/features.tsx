const features = [
    {
        title: 'Low Learning Curve',
        desc: 'Write JSX you already know — no new APIs to memorize.',
    },
    {
        title: 'Few Dependencies',
        desc: '@types/node csstype tsx typescript',
    },
    {
        title: 'Fast Hot Reload',
        desc: 'Instant feedback in the browser as you save.',
    },
    {
        title: 'TypeScript First',
        desc: 'Full type safety from day one, no config required.',
    },
    {
        title: 'Static Output',
        desc: 'Builds to a single index.html with embedded CSS and JS.',
    },
    {
        title: 'Asset Pipeline',
        desc: 'Drop files in the assets folder and they just work.',
    },
    {
        title: 'Zero Config',
        desc: 'Sensible defaults get you running in seconds.',
    },
    {
        title: 'Dev Server',
        desc: 'Local server with live reload via WebSocket on port 8080.',
    },
];

export function Features() {
    return (
        <section class="features">
            <h2>Features</h2>
            <ul class="feature-grid">
                {features.map((f) => (
                    <li class="feature-card">
                        <strong>{f.title}</strong>
                        <p>{f.desc}</p>
                    </li>
                ))}
            </ul>
        </section>
    );
}
