import { Fragment, type ReactNode } from "react";

/** Split `text` into nodes, wrapping case-insensitive matches of any query
 *  term in <mark>. Returns plain text when there is nothing to highlight. */
export function highlightMatch(text: string, query: string): ReactNode {
  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length >= 2)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  if (terms.length === 0) return text;

  // Capturing group => odd-indexed parts are the matched substrings.
  const re = new RegExp(`(${terms.join("|")})`, "ig");
  const parts = text.split(re);
  return parts.map((part, i) =>
    i % 2 === 1 ? <mark key={i}>{part}</mark> : <Fragment key={i}>{part}</Fragment>,
  );
}
