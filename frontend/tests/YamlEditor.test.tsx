import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { YamlEditor } from "../src/components/YamlEditor";

const configureMonacoYaml = vi.fn();
const defineTheme = vi.fn();

// The real setup module pulls in the full monaco-editor bundle and Vite
// `?worker` entry points, neither of which belongs in a jsdom unit test.
vi.mock("../src/lib/monacoSetup", () => ({ monaco: {} }));

vi.mock("monaco-yaml", () => ({
  configureMonacoYaml: (...args: unknown[]) => configureMonacoYaml(...args),
}));

vi.mock("@monaco-editor/react", () => ({
  default: ({ value, onChange, onMount, theme }: any) => {
    onMount?.({}, { editor: { defineTheme }, languages: { yaml: {} } });
    return (
      <textarea
        aria-label="yaml-editor"
        data-monaco-theme={theme}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  },
}));

describe("YamlEditor", () => {
  it("renders the given YAML value", () => {
    render(<YamlEditor value={"cv:\n  name: Test"} onChange={vi.fn()} theme="light" />);
    expect(screen.getByLabelText("yaml-editor")).toHaveValue("cv:\n  name: Test");
  });

  it("calls onChange with the new content when edited", () => {
    const onChange = vi.fn();
    render(<YamlEditor value="" onChange={onChange} theme="light" />);
    fireEvent.change(screen.getByLabelText("yaml-editor"), {
      target: { value: "cv:\n  name: X" },
    });
    expect(onChange).toHaveBeenCalledWith("cv:\n  name: X");
  });

  it("configures monaco-yaml with the vendored rendercv schema on mount", () => {
    render(<YamlEditor value="" onChange={vi.fn()} theme="light" />);
    expect(configureMonacoYaml).toHaveBeenCalledOnce();
    const [, options] = configureMonacoYaml.mock.calls[0];
    expect(options.schemas[0].schema).toBeTruthy();
  });

  it("registers the manuscript theme on mount", () => {
    render(<YamlEditor value="" onChange={vi.fn()} theme="light" />);
    expect(defineTheme).toHaveBeenCalledWith("manuscript", expect.any(Object));
  });

  it("uses the manuscript theme in light mode", () => {
    render(<YamlEditor value="" onChange={vi.fn()} theme="light" />);
    expect(screen.getByLabelText("yaml-editor")).toHaveAttribute(
      "data-monaco-theme",
      "manuscript"
    );
  });

  it("uses Monaco's built-in vs-dark theme in dark mode", () => {
    render(<YamlEditor value="" onChange={vi.fn()} theme="dark" />);
    expect(screen.getByLabelText("yaml-editor")).toHaveAttribute("data-monaco-theme", "vs-dark");
  });
});
