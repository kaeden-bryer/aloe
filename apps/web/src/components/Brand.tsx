import { useNavigate } from "react-router";
import { AloeLogo } from "./Icons";

/**
 * The logo button that leads home; sizes differ per screen as in the design.
 * `hover` is the design's hover class: "glass" on the dark hero, "ghost" on light pages.
 */
export function Brand({ logoSize, hover = "ghost" }: { logoSize: number; hover?: "ghost" | "glass" }) {
  const navigate = useNavigate();
  return (
    <button type="button" className={`brand ${hover}`} aria-label="Aloe home" onClick={() => navigate("/")}>
      <AloeLogo size={logoSize} />
      <span className="brand-name">Aloe</span>
    </button>
  );
}
