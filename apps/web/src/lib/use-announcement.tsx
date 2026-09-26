import { useCallback, useState } from "react";

// A polite live region, and `announce`, which has it say a line. Each line is a new node,
// because a screen reader says only what changed, so words said before are said again.
export function useAnnouncement() {
  const [announcement, setAnnouncement] = useState({ text: "", count: 0 });
  const announce = useCallback((text: string) => {
    setAnnouncement((previous) => ({ text, count: previous.count + 1 }));
  }, []);
  const region = (
    <p aria-live="polite" className="sr-only">
      <span key={announcement.count}>{announcement.text}</span>
    </p>
  );
  return [region, announce] as const;
}
