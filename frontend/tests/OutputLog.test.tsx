import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { OutputLog } from "../src/components/OutputLog";

describe("OutputLog", () => {
  it("shows a placeholder when there are no lines yet", () => {
    render(<OutputLog lines={[]} />);
    expect(screen.getByText("No output yet.")).toBeInTheDocument();
  });

  it("renders each log line in order", () => {
    render(<OutputLog lines={["Validating YAML...", "Compiling with Typst...", "Done."]} />);
    const log = screen.getByTestId("output-log");
    expect(log.textContent).toBe("Validating YAML...Compiling with Typst...Done.");
  });

  it("shows no severity suffix when there are no errors or warnings", () => {
    render(<OutputLog lines={["Compiling with Typst...", "Done."]} />);
    expect(screen.getByText("Output — 2 lines")).toBeInTheDocument();
  });

  it("appends (Warning) to the title when a line mentions a warning", () => {
    render(<OutputLog lines={["Compiling...", "warning: missing font"]} />);
    expect(screen.getByText("Output — 2 lines (Warning)")).toBeInTheDocument();
  });

  it("appends (Error) to the title, taking priority over a warning", () => {
    render(
      <OutputLog lines={["warning: missing font", "Error: rendercv exited with code 1"]} />
    );
    expect(screen.getByText("Output — 2 lines (Error)")).toBeInTheDocument();
  });
});
