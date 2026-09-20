import { useState, type ChangeEvent } from "react";
import { deleteImage, uploadImage } from "../lib/api";

interface ImageUploadProps {
  sessionId: string;
}

export function ImageUpload({ sessionId }: ImageUploadProps) {
  const [progress, setProgress] = useState<number | null>(null);
  const [uploadedFilename, setUploadedFilename] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setError(null);
    setProgress(0);
    try {
      const result = await uploadImage(file, sessionId, setProgress);
      setUploadedFilename(result.filename);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setProgress(null);
      event.target.value = "";
    }
  }

  async function handleRemove() {
    await deleteImage(sessionId);
    setUploadedFilename(null);
  }

  return (
    <>
      <label
        className="cursor-pointer rounded-sm border border-rule bg-page px-3 py-1.5 font-serif text-sm text-ink-soft
          transition-colors duration-150 hover:border-accent hover:text-accent
          focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
      >
        Upload photo
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
      </label>
      <p className="text-xs text-muted">You can reference the image by just its filename.</p>
      {progress !== null && (
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-rule">
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-200 ease-out"
            style={{ width: `${progress}%` }}
          />
        </div>
      )}
      {uploadedFilename && (
        <div className="flex items-center gap-2 text-sm text-success">
          <span>Received: {uploadedFilename}</span>
          <button
            className="text-muted underline transition-colors duration-150 hover:text-error"
            onClick={handleRemove}
          >
            Remove
          </button>
        </div>
      )}
      {error && <p className="text-sm text-error">{error}</p>}
    </>
  );
}
