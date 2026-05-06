const features = [
    {
        title: (
            <>
                TypeScript First
                <br />
                <i>TypeScript Only</i>
            </>
        ),
        desc: 'Full type safety from day one for your JSX components and client-side code.',
    },
    {
        title: (
            <>
                Live Reload
                <br />
                <i>for Development</i>
            </>
        ),
        desc: 'Save a file and the browser updates instantly — no refresh, no waiting.',
    },
    {
        title: (
            <>
                Static Output
                <br />
                <i>for Production</i>
            </>
        ),
        desc: 'Builds to a single index.html with CSS and JS embedded and ready to deploy.',
    },
    {
        title: (
            <>
                Devops Headaches
                <br />
                <i>Solved</i>
            </>
        ),
        desc: 'Drop in scratch.ts and run init — sane defaults get you building in seconds.',
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
