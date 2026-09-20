import "@testing-library/jest-dom/vitest";

// jsdom doesn't implement ResizeObserver; react-resizable-panels needs one
// to measure the Group/Panel elements it lays out.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= ResizeObserverStub as unknown as typeof ResizeObserver;
