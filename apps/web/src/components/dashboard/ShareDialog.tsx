/**
 * "Share your week" modal: a preview card, the post text, intent links for
 * X / LinkedIn / Bluesky, and a copy button.
 */
import { useEffect, useRef } from "react";
import type { SharePost } from "../../lib/share";
import { AloeLogo, CloseIcon, CopyIcon } from "../Icons";
import { useToast } from "../Toast";

// The decorative pixel grid in the card's corner: [color, opacity] or null for a gap.
const PIXELS: ([string, number] | null)[] = [
  ["#8FE3AA", 1], null, ["#C7F2D4", 0.6], null, ["#5FBF83", 1], ["#8FE3AA", 0.4],
  null, ["#5FBF83", 0.7], null, ["#A8E6BD", 1], null, ["#C7F2D4", 0.5],
  ["#A8E6BD", 0.5], null, ["#8FE3AA", 1], null, null, ["#5FBF83", 1],
];

export function ShareDialog({ post, onClose }: { post: SharePost; onClose: () => void }) {
  const flash = useToast();
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    // Move focus into the dialog, close on Escape, and give focus back on close.
    const before = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      before?.focus();
    };
  }, [onClose]);

  const copy = () => {
    // navigator.clipboard is missing on insecure origins, hence the optional chaining.
    const write = navigator.clipboard?.writeText(post.postText);
    if (!write) return flash("Could not copy here. Select the text instead.");
    write.then(
      () => flash("Copied. Paste it anywhere."),
      () => flash("Could not copy here. Select the text instead."),
    );
  };

  return (
    <div className="backdrop" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-labelledby="share-title" className="dialog" onClick={(e) => e.stopPropagation()}>
        <div className="dialog-head">
          <h2 id="share-title">Share your week</h2>
          <button ref={closeRef} type="button" className="icon-btn ghost" aria-label="Close" onClick={onClose}>
            <CloseIcon />
          </button>
        </div>

        <div className="share-card">
          <div className="share-pixels" aria-hidden="true">
            {PIXELS.map((p, i) => (
              <span key={i} style={p ? { background: p[0], opacity: p[1] } : undefined} />
            ))}
          </div>
          <div className="share-brand">
            <AloeLogo size={22} />
            Aloe
          </div>
          <div style={{ flex: 1 }} />
          <div className="share-eyebrow">My unused AI, this week</div>
          <div className="share-headline">{post.headline}</div>
          <div className="share-sub">{post.sub}</div>
          <div className="share-chips">
            {post.chips.map((c) => (
              <span key={c}>{c}</span>
            ))}
          </div>
        </div>

        <div className="post-label">Post text</div>
        <p className="post-text">{post.postText}</p>

        <div className="share-actions">
          <a className="share-link ghost" href={post.links.x} target="_blank" rel="noopener">Post on X</a>
          <a className="share-link ghost" href={post.links.linkedIn} target="_blank" rel="noopener">LinkedIn</a>
          <a className="share-link ghost" href={post.links.bluesky} target="_blank" rel="noopener">Bluesky</a>
          <button type="button" className="btn-primary primary" onClick={copy}>
            <CopyIcon />
            Copy text
          </button>
        </div>
      </div>
    </div>
  );
}
