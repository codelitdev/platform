"use client";

import React from "react";

export interface TooltipProps {
  label: React.ReactNode;
  /** Force visibility (for specimens/screenshots). */
  open?: boolean;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/** Hover tooltip. Wraps its child; shows label above on hover. */
export function Tooltip({ label, open, children, style }: TooltipProps) {
  const [hover, setHover] = React.useState(false);
  const show = open ?? hover;
  return (
    <span
      className="cl-tooltip-wrap"
      style={style}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
    >
      {children}
      {show ? <span className="cl-tooltip" role="tooltip">{label}</span> : null}
    </span>
  );
}
