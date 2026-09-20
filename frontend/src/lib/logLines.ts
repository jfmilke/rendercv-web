// Render output is unstructured text (our own "Error: ..." messages plus
// whatever the rendercv/Typst subprocess prints), so severity is inferred
// from the words the line itself contains.
export function isErrorLine(line: string): boolean {
  return /error/i.test(line);
}

export function isWarningLine(line: string): boolean {
  return /warning/i.test(line);
}
