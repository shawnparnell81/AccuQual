import { Fragment } from "react";

/**
 * No markdown library exists anywhere in this app — rather than add a new
 * dependency for it, this renders the realistic subset an assistant
 * response actually uses (paragraphs, bold, italic, inline code, fenced
 * code blocks, bullet lists) as real React elements. Never
 * dangerouslySetInnerHTML — every character the model produced ends up as
 * plain text content, never parsed as HTML.
 */
export function MarkdownLite({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/);

  return (
    <div className="flex flex-col gap-2 text-sm">
      {blocks.map((block, i) => {
        if (block.startsWith("```")) {
          const code = block.replace(/^```[a-z]*\n?/, "").replace(/```$/, "");
          return (
            <pre key={i} className="overflow-x-auto rounded-md bg-muted p-2 text-xs">
              <code>{code}</code>
            </pre>
          );
        }

        const lines = block.split("\n");
        const isList = lines.every((l) => /^[-*]\s+/.test(l.trim()) || l.trim() === "");
        if (isList) {
          return (
            <ul key={i} className="list-disc pl-5">
              {lines.filter((l) => l.trim()).map((l, j) => (
                <li key={j}>{renderInline(l.replace(/^[-*]\s+/, ""))}</li>
              ))}
            </ul>
          );
        }

        return <p key={i}>{lines.map((l, j) => <Fragment key={j}>{j > 0 && <br />}{renderInline(l)}</Fragment>)}</p>;
      })}
    </div>
  );
}

/** **bold**, *italic*, `code` — split-and-map over one line, never regex-replace into raw HTML. */
function renderInline(line: string) {
  const parts = line.split(/(\*\*[^*]+\*\*|\*[^*]+\*|`[^`]+`)/g);
  return parts.map((part, i) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={i}>{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={i} className="rounded bg-muted px-1 py-0.5 text-xs">{part.slice(1, -1)}</code>;
    if (part.startsWith("*") && part.endsWith("*") && part.length > 2) return <em key={i}>{part.slice(1, -1)}</em>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
