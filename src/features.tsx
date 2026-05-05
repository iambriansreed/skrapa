const features = [
    {
        title: 'TypeScript First<br /><i>TypeScript Only</i>',
        desc: 'Full type safety from day one for TSX and client-side code.',
    },
    { title: 'Live Reload<br /><i>for Development</i>', desc: 'Instant feedback in the browser as you save.' },
    {
        title: 'Static Output<br /><i>for Production</i>',
        desc: 'Builds to a single index.html with embedded CSS and JS.',
    },
    {
        title: 'Devops Headaches<br /><i>Solved</i>',
        desc: 'No setup required. Drop in scratch.ts and go — sane defaults handle the rest.',
    },
];
export function Features() {
    return (
        <section class="features">
            <h2>Features</h2>
            <ul class="feature-grid">
                {' '}
                {features.map((f) => (
                    <li class="feature-card">
                        <strong>{f.title}</strong>
                        <p>{f.desc}</p>
                    </li>
                ))}{' '}
            </ul>
        </section>
    );
}
