import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { highlightMatch } from "./highlight.tsx";

describe("highlightMatch", () => {
  it("wraps the matched substring in <mark>", () => {
    render(<p>{highlightMatch("Ginkgo biloba", "gink")}</p>);
    const mark = screen.getByText("Gink");
    expect(mark.tagName).toBe("MARK");
  });

  it("matches case-insensitively and keeps the rest as text", () => {
    const { container } = render(<p>{highlightMatch("Acer palmatum", "ACER")}</p>);
    expect(container.querySelectorAll("mark")).toHaveLength(1);
    expect(container).toHaveTextContent("Acer palmatum");
  });

  it("returns plain text when there is nothing to highlight", () => {
    const { container } = render(<p>{highlightMatch("Quercus robur", "x")}</p>);
    expect(container.querySelector("mark")).toBeNull();
  });
});
