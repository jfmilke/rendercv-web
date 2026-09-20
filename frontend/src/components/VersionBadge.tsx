import { useEffect, useState } from "react";
import { fetchVersion } from "../lib/api";

export function VersionBadge() {
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    fetchVersion()
      .then(setVersion)
      .catch(() => setVersion(null));
  }, []);

  return (
    <span className="font-serif text-xs italic text-muted">
      {version ? `rendercv v${version}` : "rendercv version unavailable"}
    </span>
  );
}
