/**
 * Looping, muted background video (hero and final CTA).
 *
 * The real clip isn't checked in yet: drop `hero.mp4` and `hero-poster.jpg`
 * into apps/web/public. Until then the video fails to load, we unmount it,
 * and the section's own dark-green gradient shows through instead.
 */
import { useEffect, useRef, useState } from "react";

export function BackgroundVideo({ src = "/hero.mp4", poster = "/hero-poster.jpg" }: { src?: string; poster?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
    // With reduced motion we leave it paused on its poster frame.
    if (!reduce) video.play().catch(() => {});
  }, []);

  if (failed) return null;
  return (
    <video
      ref={ref}
      className="media-fill"
      src={src}
      poster={poster}
      muted
      loop
      playsInline
      aria-hidden="true"
      onError={() => setFailed(true)}
    />
  );
}
