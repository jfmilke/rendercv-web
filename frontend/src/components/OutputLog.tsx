interface OutputLogProps {
  lines: string[];
}

export function OutputLog({ lines }: OutputLogProps) {
  return (
    <div
      className="h-40 overflow-y-auto rounded-xl bg-field-bg p-3 font-mono text-xs text-gray-200"
      data-testid="output-log"
    >
      {lines.length === 0 ? (
        <p className="text-gray-500">No output yet.</p>
      ) : (
        lines.map((line, index) => <div key={index}>{line}</div>)
      )}
    </div>
  );
}
