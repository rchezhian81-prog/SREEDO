// @vitest-environment jsdom
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { Button, ErrorNote, Field, Input, Modal, SkipLink, Spinner } from "./ui";

afterEach(cleanup);

describe("UI accessibility primitives", () => {
  it("associates a Field's label with its control and wires error a11y", () => {
    const { rerender } = render(
      <Field label="Email">
        <Input type="email" />
      </Field>
    );
    const input = screen.getByLabelText("Email");
    expect(input).toBeTruthy();
    // No error yet → not marked invalid.
    expect(input.getAttribute("aria-invalid")).toBeNull();

    rerender(
      <Field label="Email" error="Required">
        <Input type="email" />
      </Field>
    );
    const invalid = screen.getByLabelText("Email");
    expect(invalid.getAttribute("aria-invalid")).toBe("true");
    const describedBy = invalid.getAttribute("aria-describedby");
    expect(describedBy).toBeTruthy();
    // The describedby target holds the error text.
    expect(document.getElementById(describedBy as string)?.textContent).toBe("Required");
  });

  it("announces errors via role=alert", () => {
    render(<ErrorNote message="Something failed" />);
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toBe("Something failed");
  });

  it("renders nothing for an empty ErrorNote", () => {
    const { container } = render(<ErrorNote message={null} />);
    expect(container.firstChild).toBeNull();
  });

  it("exposes the spinner as a status with a text alternative", () => {
    render(<Spinner />);
    const status = screen.getByRole("status");
    expect(status.textContent).toContain("Loading");
  });

  it("gives the modal dialog semantics, a label, and Escape-to-close", () => {
    const onClose = vi.fn();
    render(
      <Modal title="Confirm" open onClose={onClose}>
        <p>Body</p>
      </Modal>
    );
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // Labelled by its title.
    const labelledBy = dialog.getAttribute("aria-labelledby");
    expect(document.getElementById(labelledBy as string)?.textContent).toBe("Confirm");
    // The close control has an accessible name.
    expect(screen.getByRole("button", { name: "Close" })).toBeTruthy();
    // Escape closes.
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("does not render the modal when closed", () => {
    render(
      <Modal title="Hidden" open={false} onClose={() => {}}>
        <p>Body</p>
      </Modal>
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("renders a skip link pointing at the main landmark", () => {
    render(<SkipLink label="Skip to main content" />);
    const link = screen.getByRole("link", { name: "Skip to main content" });
    expect(link.getAttribute("href")).toBe("#main-content");
  });

  it("keeps a keyboard focus ring on buttons", () => {
    render(<Button>Save</Button>);
    const button = screen.getByRole("button", { name: "Save" });
    expect(button.className).toContain("focus-visible:ring");
  });
});
