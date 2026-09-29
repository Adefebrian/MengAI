// Read-only file viewer: the path and size above, the text in mono with
// line numbers from a CSS counter, and one scroller in both directions, so
// long lines scroll inside the view and never widen the page.
export interface CodeViewProps {
  path: string;
  content: string;
  meta?: string;
  /** a binary or empty file: say so instead of showing nothing */
  note?: string | null;
}

export function CodeView({ path, content, meta, note }: CodeViewProps) {
  const lines = content.replace(/\n$/, "").split("\n");
  return (
    <figure className="p-code">
      <figcaption className="p-code-head">
        <span className="p-code-path" title={path}>
          {path}
        </span>
        {meta ? <span className="p-code-meta">{meta}</span> : null}
      </figcaption>
      {note ? (
        <p className="p-code-note">{note}</p>
      ) : (
        <pre className="p-code-body" tabIndex={0} aria-label={`Contents of ${path}`}>
          <code>
            {lines.map((line, i) => (
              <span className="p-code-line" key={i}>
                {line.length > 0 ? line : " "}
              </span>
            ))}
          </code>
        </pre>
      )}
    </figure>
  );
}
