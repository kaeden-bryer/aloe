/** Inline SVG icons from the design. All are decorative (aria-hidden). */
import type { SVGProps } from "react";

type IconProps = { size?: number } & SVGProps<SVGSVGElement>;

const stroke = (size: number, width: number, rest: SVGProps<SVGSVGElement>) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: width,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
  ...rest,
});

export function AloeLogo({ size = 30 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="#2F7D4F" />
      <path d="M16 25 C 13 18, 13.5 11, 16 5 C 18.5 11, 19 18, 16 25 Z" fill="#DFF0E4" />
      <path d="M15 25 C 11 22, 8 18, 6.5 12.5 C 10.5 15, 13.5 19, 15 25 Z" fill="#B7DCC3" />
      <path d="M17 25 C 21 22, 24 18, 25.5 12.5 C 21.5 15, 18.5 19, 17 25 Z" fill="#B7DCC3" />
    </svg>
  );
}

export const ArrowRight = ({ size = 18, strokeWidth = 2.2, ...rest }: IconProps) => (
  <svg {...stroke(size, Number(strokeWidth), rest)}>
    <path d="M5 12h14M13 6l6 6-6 6" />
  </svg>
);

export const CheckIcon = ({ size = 13, strokeWidth = 3.5, ...rest }: IconProps) => (
  <svg {...stroke(size, Number(strokeWidth), rest)}>
    <path d="M5 12l5 5L20 7" />
  </svg>
);

export const PlusIcon = ({ size = 17, ...rest }: IconProps) => (
  <svg {...stroke(size, 2, rest)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const ShareIcon = ({ size = 17, ...rest }: IconProps) => (
  <svg {...stroke(size, 2, rest)}>
    <path d="M12 15V3M7 8l5-5 5 5" />
    <path d="M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </svg>
);

export const CloseIcon = ({ size = 18, ...rest }: IconProps) => (
  <svg {...stroke(size, 2, rest)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const CopyIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...stroke(size, 2, rest)}>
    <rect x="9" y="9" width="11" height="11" rx="2" />
    <path d="M5 15V5a1 1 0 0 1 1-1h10" />
  </svg>
);

export const InfoIcon = ({ size = 16, ...rest }: IconProps) => (
  <svg {...stroke(size, 2, rest)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 11v5M12 8h.01" />
  </svg>
);

export const WarningIcon = ({ size = 20, ...rest }: IconProps) => (
  <svg {...stroke(size, 2, { stroke: "#9A5B13", style: { flex: "none", marginTop: 2 }, ...rest })}>
    <path d="M12 3l9 16H3z" />
    <path d="M12 10v4M12 17h.01" />
  </svg>
);

export const DashboardIcon = () => (
  <svg {...stroke(18, 1.8, {})}>
    <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
  </svg>
);

export const MarketIcon = () => (
  <svg {...stroke(18, 1.8, {})}>
    <rect x="3.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="3.5" width="7" height="7" rx="1.5" />
    <rect x="3.5" y="13.5" width="7" height="7" rx="1.5" />
    <rect x="13.5" y="13.5" width="7" height="7" rx="1.5" />
  </svg>
);

export const SettingsIcon = () => (
  <svg {...stroke(18, 1.8, {})}>
    <path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
    <circle cx="16" cy="7" r="2" />
    <circle cx="10" cy="17" r="2" />
  </svg>
);
