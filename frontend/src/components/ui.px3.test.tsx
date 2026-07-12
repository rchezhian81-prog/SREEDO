// @vitest-environment jsdom
import { afterEach, describe, it, expect } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";
import { Badge, Drawer, EmptyState } from "./ui";

afterEach(cleanup);

// PX3-A foundation: the new/extended primitives keep the token contract and the
// accessibility contract (labelled dialog, next-step empty state).

describe("Badge semantic tones", () => {
  it("maps success/warn/danger/info to the status tokens", () => {
    for (const [tone, cls] of [
      ["success", "text-success"],
      ["warn", "text-warn"],
      ["danger", "text-danger"],
      ["info", "text-info"],
    ] as const) {
      const { container } = render(<Badge tone={tone}>x</Badge>);
      expect((container.firstChild as HTMLElement).className).toContain(cls);
      cleanup();
    }
  });

  it("keeps the legacy colour aliases working (no caller breaks)", () => {
    const { container } = render(<Badge tone="green">ok</Badge>);
    // green now resolves through the success token — still theme-aware.
    expect((container.firstChild as HTMLElement).className).toContain("text-success");
  });
});

describe("Drawer", () => {
  it("renders nothing when closed", () => {
    render(<Drawer title="Detail" open={false} onClose={() => {}}>body</Drawer>);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("is a labelled modal dialog when open", () => {
    render(<Drawer title="Audit detail" open onClose={() => {}}>body</Drawer>);
    const dlg = screen.getByRole("dialog");
    expect(dlg.getAttribute("aria-modal")).toBe("true");
    expect(screen.getByRole("heading", { name: "Audit detail" })).toBeTruthy();
    expect(screen.getByLabelText("Close")).toBeTruthy();
  });

  it("renders a footer region when provided", () => {
    render(
      <Drawer title="D" open onClose={() => {}} footer={<button>Save</button>}>
        body
      </Drawer>
    );
    expect(screen.getByRole("button", { name: "Save" })).toBeTruthy();
  });
});

describe("EmptyState", () => {
  it("renders message-only (backward compatible)", () => {
    render(<EmptyState message="No invoices yet" />);
    expect(screen.getByText("No invoices yet")).toBeTruthy();
  });

  it("renders a next-step action when given", () => {
    render(<EmptyState message="No invoices yet" icon="card" action={<button>New invoice</button>} />);
    expect(screen.getByRole("button", { name: "New invoice" })).toBeTruthy();
  });
});
