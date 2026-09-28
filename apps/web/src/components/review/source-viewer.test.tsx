import { fireEvent, screen } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { renderWithIntl } from "@/test/render-with-intl";
import { SourceViewer } from "./source-viewer";
const scrollIntoView = vi.fn();
const scrollBy = vi.fn();
beforeEach(() => {
  Object.defineProperty(Element.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoView,
  });
  Object.defineProperty(Element.prototype, "scrollBy", {
    configurable: true,
    value: scrollBy,
  });
  scrollIntoView.mockClear();
  scrollBy.mockClear();
});
const document = {
  title: "Synthetic document",
  synthetic: true,
  pages: [1, 2].map((number) => ({
    number,
    imageSrc: "/showcase/synthetic-emirates-id-front.svg",
    alt: `Synthetic page ${String(number)}`,
  })),
};
it("zooms in 25 point increments, clamps limits, rotates and resets", () => {
  renderWithIntl(<SourceViewer document={document} selection={null} />);
  const viewport = screen.getByRole("region", { name: /Source viewer:/ });
  fireEvent.keyDown(viewport, { key: "+" });
  fireEvent.keyDown(viewport, { key: "+" });
  fireEvent.keyDown(viewport, { key: "-" });
  expect(screen.getByTestId("zoom-level")).toHaveTextContent("Zoom 125%");
  for (let index = 0; index < 10; index++)
    fireEvent.click(screen.getByRole("button", { name: "Zoom in" }));
  expect(screen.getByTestId("zoom-level")).toHaveTextContent("Zoom 200%");
  expect(screen.getByRole("button", { name: "Zoom in" })).toBeDisabled();
  for (let index = 0; index < 10; index++)
    fireEvent.keyDown(viewport, { key: "-" });
  expect(screen.getByTestId("zoom-level")).toHaveTextContent("Zoom 50%");
  expect(screen.getByRole("button", { name: "Zoom out" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Rotate clockwise" }));
  expect(
    screen.getByAltText("Synthetic page 1").parentElement?.parentElement,
  ).toHaveStyle({ transform: "rotate(90deg)" });
  fireEvent.click(screen.getByRole("button", { name: "Reset view" }));
  expect(screen.getByTestId("zoom-level")).toHaveTextContent("Zoom 100%");
  expect(
    screen.getByAltText("Synthetic page 1").parentElement?.parentElement,
  ).toHaveStyle({ transform: "rotate(0deg)" });
});
it("navigates pages with bounds and pans only from viewer focus", () => {
  renderWithIntl(<SourceViewer document={document} selection={null} />);
  expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  fireEvent.click(screen.getByRole("button", { name: "Next page" }));
  expect(screen.getByText("Page 2 of 2")).toBeInTheDocument();
  expect(screen.getByRole("button", { name: "Next page" })).toBeDisabled();
  expect(scrollIntoView).toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Previous page" }));
  expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
  const viewport = screen.getByRole("region", { name: /Source viewer:/ });
  fireEvent.keyDown(viewport, { key: "ArrowRight" });
  expect(scrollBy).toHaveBeenCalledWith({ left: 48, top: 0 });
  fireEvent.keyDown(viewport, { key: "ArrowDown" });
  expect(scrollBy).toHaveBeenCalledWith({ left: 0, top: 48 });
  fireEvent.keyDown(screen.getByAltText("Synthetic page 1"), { key: "+" });
  expect(screen.getByTestId("zoom-level")).toHaveTextContent("Zoom 100%");
});
it("opens the selected page and outlines coordinates without mirroring the image", () => {
  const selection = {
    fieldId: "name",
    label: "Name",
    descriptionId: "source-description",
    region: { page: 2, x: 0.2, y: 0.3, width: 0.4, height: 0.1 },
    page: 2,
    request: 1,
  };
  renderWithIntl(<SourceViewer document={document} selection={selection} />);
  expect(scrollIntoView).toHaveBeenCalled();
  expect(screen.getByTestId("source-region")).toHaveStyle({
    insetInlineStart: "20%",
    insetBlockStart: "30%",
    width: "40%",
    height: "10%",
  });
  expect(screen.getAllByText("SYNTHETIC")).toHaveLength(2);
});
it("omits the watermark for a non-synthetic source", () => {
  renderWithIntl(
    <SourceViewer
      document={{ ...document, synthetic: false }}
      selection={null}
    />,
  );
  expect(screen.queryByText("SYNTHETIC")).not.toBeInTheDocument();
});
