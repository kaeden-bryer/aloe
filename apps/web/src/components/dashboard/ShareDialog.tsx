/**
 * "Share your week" modal: a preview card, the post text, intent links for
 * X / LinkedIn / Bluesky, and a copy button.
 */
import { useEffect, useRef, useState } from "react";
import type { SharePost } from "../../lib/share";
import { AloeLogo, CloseIcon, CopyIcon } from "../Icons";
import { useToast } from "../Toast";
import type { CardData } from "../../lib/shareCard";
import { renderShareCard } from "../../lib/shareCardRender";

// The decorative pixel grid in the card's corner: [color, opacity] or null for a gap.
const PIXELS: ([string, number] | null)[] = [
  ["#8FE3AA", 1], null, ["#C7F2D4", 0.6], null, ["#5FBF83", 1], ["#8FE3AA", 0.4],
  null, ["#5FBF83", 0.7], null, ["#A8E6BD", 1], null, ["#C7F2D4", 0.5],
  ["#A8E6BD", 0.5], null, ["#8FE3AA", 1], null, null, ["#5FBF83", 1],
];

export function ShareDialog({ post, card, onClose }: { post: SharePost; card?: CardData; onClose: () => void }) {
  const flash = useToast();
  const closeRef = useRef<HTMLButtonElement>(null);
  // The generated 1200x630 PNG. Until it's ready (or if canvas fails) we show the CSS card below.
  const [image, setImage] = useState<{ blob: Blob; url: string } | null>(null);

  useEffect(() => {
    if (!card) return;
    let cancelled = false;
    let url = "";
    renderShareCard(card).then(
      (blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setImage({ blob, url });
      },
      () => {}, // keep the CSS preview; image actions just stay hidden
    );
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url); // object URLs leak memory unless revoked
    };
  }, [card]);

  const file = () => new File([image!.blob], "aloe-my-week.png", { type: "image/png" });
  // Feature-detect each API: Safari/Firefox/insecure origins lack some of them.
  const canCopyImage = typeof ClipboardItem !== "undefined" && !!navigator.clipboard?.write;
  const canShareFile = !!image && typeof navigator.canShare === "function" && navigator.canShare({ files: [file()] });

  const copyImage = () => {
    if (!image) return;
    navigator.clipboard.write([new ClipboardItem({ "image/png": image.blob })]).then(
      () => flash("Image copied. Paste it into your post."),
      () => flash("Could not copy the image here. Use Download instead."),
    );
  };
  const nativeShare = () => {
    if (!image) return;
    navigator.share({ files: [file()], text: post.postText }).catch((e: unknown) => {
      // AbortError just means the user closed the share sheet.
      if ((e as Error)?.name !== "AbortError") flash("Could not open the share sheet. Use Download instead.");
    });
  };

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

        {image ? (
          <img className="share-image" src={image.url} width={1200} height={630} alt={"Share card: " + post.headline + " " + post.sub} />
        ) : (
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
        )}

        {image && (
          <div className="share-actions">
            <a className="share-link ghost" href={image.url} download="aloe-my-week.png">Download PNG</a>
            {canCopyImage && <button type="button" className="share-link ghost" onClick={copyImage}>Copy image</button>}
            {canShareFile && <button type="button" className="share-link ghost" onClick={nativeShare}>Share image</button>}
          </div>
        )}

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
