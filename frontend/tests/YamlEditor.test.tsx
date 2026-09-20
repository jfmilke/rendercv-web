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
  default: ({ value, onChange, onMount }: any) => {
    onMount?.({}, { editor: { defineTheme }, languages: { yaml: {} } });
    return (
      <textarea
        aria-label="yaml-editor"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    );
  },
}));

describe("YamlEditor", () => {
  it("renders the given YAML value", () => {
    render(<YamlEditor value={"cv:\n  name: Test"} onChange={vi.fn()} />);
    expect(screen.getByLabelText("yaml-editor")).toHaveValue("cv:\n  name: Test");
  });

  it("calls onChange with the new content when edited", () => {
    const onChange = vi.fn();
    render(<YamlEditor value="" onChange={onChange} />);
    fireEvent.change(screen.getByLabelText("yaml-editor"), {
      target: { value: "cv:\n  name: X" },
    });
    expect(onChange).toHaveBeenCalledWith("cv:\n  name: X");
  });

  it("configures monaco-yaml with the vendored rendercv schema on mount", () => {
    render(<YamlEditor value="" onChange={vi.fn()} />);
    expect(configureMonacoYaml).toHaveBeenCalledOnce();
    const [, options] = configureMonacoYaml.mock.calls[0];
    expect(options.schemas[0].schema).toBeTruthy();
  });

  it("registers the manuscript theme on mount", () => {
    render(<YamlEditor value="" onChange={vi.fn()} />);
    expect(defineTheme).toHaveBeenCalledWith("manuscript", expect.any(Object));
  });
});
