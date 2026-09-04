import React from "react";

export interface BadgeProps {
  variant?: "default" | "neutral" | "success" | "warning" | "destructive" | "outline";
  /** Leading 6px status dot in currentColor. */
  dot?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/** Status pill. Set dot for live/state indicators. */
export function Badge({ variant = "default", dot, children, style }: BadgeProps) {
  return (
    <span className={`cl-badge cl-badge--${variant}`} style={style}>
      {dot ? <span className="cl-badge__dot"></span> : null}
      {children}
    </span>
  );
}
