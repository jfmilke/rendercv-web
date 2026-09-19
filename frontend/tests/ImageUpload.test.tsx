import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ImageUpload } from "../src/components/ImageUpload";
import * as api from "../src/lib/api";

describe("ImageUpload", () => {
  it("shows a success indicator once the upload completes", async () => {
    vi.spyOn(api, "uploadImage").mockImplementation(async (_file, _sessionId, onProgress) => {
      onProgress(100);
      return { filename: "me.png" };
    });
    render(<ImageUpload sessionId="session-1" />);

    const file = new File(["fake-bytes"], "me.png", { type: "image/png" });
    const input = screen.getByLabelText("Upload photo", { selector: "input" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("Received: me.png")).toBeInTheDocument();
  });

  it("shows an error message when the upload fails", async () => {
    vi.spyOn(api, "uploadImage").mockRejectedValue(new Error("File is not a recognized image"));
    render(<ImageUpload sessionId="session-1" />);

    const file = new File(["fake-bytes"], "me.txt", { type: "text/plain" });
    const input = screen.getByLabelText("Upload photo", { selector: "input" });
    fireEvent.change(input, { target: { files: [file] } });

    expect(await screen.findByText("File is not a recognized image")).toBeInTheDocument();
  });

  it("clears the uploaded filename when Remove is clicked", async () => {
    vi.spyOn(api, "uploadImage").mockResolvedValue({ filename: "me.png" });
    vi.spyOn(api, "deleteImage").mockResolvedValue(undefined);
    render(<ImageUpload sessionId="session-1" />);

    const file = new File(["fake-bytes"], "me.png", { type: "image/png" });
    const input = screen.getByLabelText("Upload photo", { selector: "input" });
    fireEvent.change(input, { target: { files: [file] } });
    await screen.findByText("Received: me.png");

    fireEvent.click(screen.getByText("Remove"));

    await waitFor(() => expect(screen.queryByText("Received: me.png")).not.toBeInTheDocument());
  });
});
