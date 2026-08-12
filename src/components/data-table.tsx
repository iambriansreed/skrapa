/**
 * A table built from divs carrying explicit ARIA roles, rather than a native
 * `<table>`.
 *
 * A `<table>` can't restyle its rows into stacked cards at narrow widths
 * without overriding `display` on every part of it, which is exactly the thing
 * that historically dropped table semantics from the accessibility tree.
 * Declaring the roles outright sidesteps the question in every browser.
 *
 * The roles double as the CSS selectors (see `[role='table']` in style.css),
 * so the semantics and the layout can't drift apart. Delete a role and the row
 * visibly stops laying out, instead of silently going quiet for screen reader
 * users only.
 * @param props
 * @param props.label - accessible name for the table as a whole
 * @param props.columns - column headers, in order
 * @param props.rows - one array of cell strings per row, matching `columns`
 * @param props.mono - indexes of the columns to render as `<code>`
 */
export function DataTable(props: {
    label: string;
    columns: string[];
    rows: string[][];
    mono?: number[];
}) {
    const mono = props.mono ?? [];

    return (
        <div role="table" aria-label={props.label}>
            <div role="row">
                {props.columns.map((column) => (
                    <span role="columnheader">{column}</span>
                ))}
            </div>
            {props.rows.map((row) => (
                <div role="row">
                    {row.map((cell, index) => (
                        <span role="cell">
                            {/* Stacked on a phone the column headers are off
                                screen, so each cell carries its own visible
                                label. aria-hidden because the columnheader
                                above already names the cell: without it every
                                cell would be announced twice. */}
                            <span aria-hidden="true">{props.columns[index] ?? ''}</span>
                            {/* Always an element, never a bare text node, so
                                the narrow-screen layout can size the value
                                against its label. */}
                            {mono.includes(index) ? <code>{cell}</code> : <span>{cell}</span>}
                        </span>
                    ))}
                </div>
            ))}
        </div>
    );
}
