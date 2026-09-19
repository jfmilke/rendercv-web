export type RenderEvent =
  | { type: "log"; line: string }
  | { type: "result"; status: "success"; pdfBase64: string }
  | { type: "result"; status: "error"; message: string };

function parseSseFrame(frame: string): RenderEvent | null {
  const lines = frame.split("\n");
  const eventLine = lines.find((line) => line.startsWith("event: "));
  const dataLine = lines.find((line) => line.startsWith("data: "));
  if (!eventLine || !dataLine) {
    return null;
  }
  const eventName = eventLine.slice("event: ".length);
  const data = JSON.parse(dataLine.slice("data: ".length));
  if (eventName === "log") {
    return { type: "log", line: data.line };
  }
  if (eventName === "result") {
    if (data.status === "success") {
      return { type: "result", status: "success", pdfBase64: data.pdf_base64 };
    }
    return { type: "result", status: "error", message: data.message };
  }
  return null;
}

export async function* streamRender(
  yamlContent: string,
  sessionId: string,
  signal?: AbortSignal
): AsyncGenerator<RenderEvent> {
  const response = await fetch("/render", {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Session-Id": sessionId },
    body: JSON.stringify({ yaml_content: yamlContent }),
    signal,
  });
  if (!response.ok || !response.body) {
    const message = await response.text();
    yield {
      type: "result",
      status: "error",
      message: message || `Request failed (${response.status})`,
    };
    return;
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let sawResult = false;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const event = parseSseFrame(frame);
      if (event) {
        if (event.type === "result") {
          sawResult = true;
        }
        yield event;
      }
    }
  }

  // The stream ended without a terminal `result` event: the connection dropped
  // mid-render (possibly leaving a partial frame in `buffer`). Surface it so
  // the caller isn't left waiting forever with no explanation.
  if (!sawResult) {
    yield {
      type: "result",
      status: "error",
      message: "Connection closed before the render finished",
    };
  }
}

export async function fetchVersion(): Promise<string> {
  const response = await fetch("/version");
  const data = await response.json();
  return data.rendercv_version;
}

export async function fetchConfig(): Promise<{ imageUploadEnabled: boolean }> {
  const response = await fetch("/config");
  return response.json();
}

export function uploadImage(
  file: File,
  sessionId: string,
  onProgress: (percent: number) => void
): Promise<{ filename: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/image");
    xhr.setRequestHeader("X-Session-Id", sessionId);
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(new Error(xhr.responseText || `Upload failed (${xhr.status})`));
      }
    };
    xhr.onerror = () => reject(new Error("Network error during upload"));
    const formData = new FormData();
    formData.append("file", file);
    xhr.send(formData);
  });
}

export async function deleteImage(sessionId: string): Promise<void> {
  await fetch("/image", { method: "DELETE", headers: { "X-Session-Id": sessionId } });
}
