import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const navigate = vi.fn();
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => navigate }));

const searchPlants = vi.fn();
const suggestTerms = vi.fn();
vi.mock("../lib/search.ts", () => ({
  searchPlants: (...a: unknown[]) => searchPlants(...a),
  suggestTerms: (...a: unknown[]) => suggestTerms(...a),
}));

// Imported after the mocks are registered.
const { SearchView } = await import("./SearchView.tsx");

const GINKGO = {
  name: "Ginkgo biloba",
  genus: "Ginkgo",
  count: 2,
  score: 5,
  specimens: [{ accession: "a", lng: -0.28, lat: 51.48 }],
};

beforeEach(() => {
  navigate.mockReset();
  searchPlants.mockReset().mockResolvedValue([GINKGO]);
  suggestTerms.mockReset().mockResolvedValue([]);
});

describe("SearchView", () => {
  it("shows grouped results as the user types", async () => {
    const user = userEvent.setup();
    render(<SearchView />);
    await user.type(screen.getByRole("textbox"), "ginkgo");
    // The name is split by <mark> highlighting, so match the option, not raw text.
    expect(await screen.findByRole("option")).toHaveTextContent("Ginkgo biloba");
    expect(screen.getByText("2 specimens")).toBeInTheDocument();
  });

  it("navigates to the map on Enter with focus params", async () => {
    const user = userEvent.setup();
    render(<SearchView />);
    const input = screen.getByRole("textbox");
    await user.type(input, "ginkgo");
    await screen.findByRole("option");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(navigate).toHaveBeenCalledWith({
      to: "/map",
      search: { focus: "-0.28,51.48", name: "Ginkgo biloba" },
    });
  });

  it("routes to the nearest specimen via the Navigate button", async () => {
    const user = userEvent.setup();
    render(<SearchView />);
    await user.type(screen.getByRole("textbox"), "ginkgo");
    await screen.findByRole("option");
    await user.click(screen.getByRole("button", { name: /Navigate to nearest/ }));
    expect(navigate).toHaveBeenCalledWith({
      to: "/map",
      search: { route: "Ginkgo biloba" },
    });
  });

  it("offers did-you-mean suggestions when there are no matches", async () => {
    searchPlants.mockResolvedValue([]);
    suggestTerms.mockResolvedValue(["ginkgo"]);
    const user = userEvent.setup();
    render(<SearchView />);
    await user.type(screen.getByRole("textbox"), "ginko");
    expect(await screen.findByRole("button", { name: "ginkgo" })).toBeInTheDocument();
  });

  it("clears the input with the clear button", async () => {
    const user = userEvent.setup();
    render(<SearchView />);
    const input = screen.getByRole<HTMLInputElement>("textbox");
    await user.type(input, "ginkgo");
    await screen.findByRole("option");
    await user.click(screen.getByLabelText("Clear search"));
    expect(input.value).toBe("");
  });
});
