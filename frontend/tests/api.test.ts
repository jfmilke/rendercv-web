import { describe, expect, it, vi } from "vitest";
import { streamRender } from "../src/lib/api";

function makeStreamResponse(text: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(text));
      controller.close();
    },
  });
  return new Response(stream, { status: 200 });
}

describe("streamRender", () => {
  it("yields log events followed by a success result", async () => {
    const sseText =
      'event: log\ndata: {"line": "Rendering..."}\n\n' +
      'event: result\ndata: {"status": "success", "pdf_base64": "AAAA"}\n\n';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeStreamResponse(sseText)));

    const events = [];
    for await (const event of streamRender("cv: {}", "session-1")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "log", line: "Rendering..." },
      { type: "result", status: "success", pdfBase64: "AAAA" },
    ]);
  });

  it("yields an error result for a non-ok response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("body too large", { status: 413 }))
    );

    const events = [];
    for await (const event of streamRender("cv: {}", "session-1")) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "result", status: "error", message: "body too large" }]);
  });

  it("handles a chunk boundary splitting a single SSE frame", async () => {
    const encoder = new TextEncoder();
    const part1 = 'event: log\ndata: {"line": "hel';
    const part2 = 'lo"}\n\n';
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(part1));
        controller.enqueue(encoder.encode(part2));
        controller.close();
      },
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(stream, { status: 200 })));

    const events = [];
    for await (const event of streamRender("cv: {}", "session-1")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "log", line: "hello" },
      {
        type: "result",
        status: "error",
        message: "Connection closed before the render finished",
      },
    ]);
  });

  it("surfaces an error when the stream ends without a terminal result event", async () => {
    const sseText = 'event: log\ndata: {"line": "Rendering..."}\n\n';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeStreamResponse(sseText)));

    const events = [];
    for await (const event of streamRender("cv: {}", "session-1")) {
      events.push(event);
    }

    expect(events).toEqual([
      { type: "log", line: "Rendering..." },
      {
        type: "result",
        status: "error",
        message: "Connection closed before the render finished",
      },
    ]);
  });

  it("surfaces an error when the stream drops mid-frame", async () => {
    // A partial frame left in the buffer when the connection dies.
    const sseText = 'event: result\ndata: {"status": "succ';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeStreamResponse(sseText)));

    const events = [];
    for await (const event of streamRender("cv: {}", "session-1")) {
      events.push(event);
    }

    expect(events).toEqual([
      {
        type: "result",
        status: "error",
        message: "Connection closed before the render finished",
      },
    ]);
  });

  it("does not append a spurious error after a terminal error result", async () => {
    const sseText = 'event: result\ndata: {"status": "error", "message": "nope"}\n\n';
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(makeStreamResponse(sseText)));

    const events = [];
    for await (const event of streamRender("cv: {}", "session-1")) {
      events.push(event);
    }

    expect(events).toEqual([{ type: "result", status: "error", message: "nope" }]);
  });
});
