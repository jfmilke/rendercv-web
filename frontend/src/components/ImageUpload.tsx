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
    <div className="flex flex-col gap-2 rounded-xl bg-panel-bg p-3 text-sm">
      <label className="cursor-pointer rounded-lg bg-field-bg px-3 py-2 text-center">
        Upload photo
        <input
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
      </label>
      <p className="text-xs text-gray-500">Images over ~10MB may take a while to upload.</p>
      {progress !== null && (
        <div className="h-2 w-full rounded-full bg-field-bg">
          <div className="h-2 rounded-full bg-accent" style={{ width: `${progress}%` }} />
        </div>
      )}
      {uploadedFilename && (
        <div className="flex items-center justify-between text-green-400">
          <span>Received: {uploadedFilename}</span>
          <button className="text-gray-400 underline" onClick={handleRemove}>
            Remove
          </button>
        </div>
      )}
      {error && <p className="text-red-400">{error}</p>}
    </div>
  );
}
