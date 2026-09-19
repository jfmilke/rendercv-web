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
});
