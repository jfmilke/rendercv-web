import { isErrorLine, isWarningLine } from "../lib/logLines";

interface OutputLogProps {
  lines: string[];
  isOpen?: boolean;
  onToggle?: () => void;
}

export function OutputLog({ lines, isOpen = true, onToggle }: OutputLogProps) {
  const hasError = lines.some(isErrorLine);
  const hasWarning = !hasError && lines.some(isWarningLine);
  const severitySuffix = hasError ? " (Error)" : hasWarning ? " (Warning)" : "";

  return (
    <div className="border-t border-rule bg-surface">
      <button
        className="flex w-full items-center justify-between px-5 py-2 font-serif text-sm text-ink-soft
          transition-colors duration-150 hover:text-accent
          focus-visible:outline focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent"
        onClick={onToggle}
        aria-expanded={isOpen}
      >
        <span>
          Output
          {lines.length > 0 ? ` — ${lines.length} line${lines.length === 1 ? "" : "s"}` : ""}
          {severitySuffix}
        </span>
        <span
          className={`text-xs transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
          aria-hidden="true"
        >
          ▲
        </span>
      </button>
      <div
        className={`grid transition-[grid-template-rows] duration-200 ease-out ${
          isOpen ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
        }`}
      >
        <div className="overflow-hidden">
          <div
            className="h-40 overflow-y-auto border-t border-rule bg-page px-5 py-3 font-mono text-xs text-ink-soft"
            data-testid="output-log"
          >
            {lines.length === 0 ? (
              <p className="text-muted">No output yet.</p>
            ) : (
              lines.map((line, index) => (
                <div
                  key={index}
                  className={
                    isErrorLine(line) ? "text-error" : isWarningLine(line) ? "text-warning" : undefined
                  }
                >
                  {line}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
