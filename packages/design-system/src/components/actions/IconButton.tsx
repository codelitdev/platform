"use client";

import React from "react";

export interface IconButtonProps {
  variant?: "ghost" | "outline";
  size?: "sm" | "md";
  /** Accessible name (aria-label + title). Required in practice. */
  label: string;
  onClick?: () => void;
  style?: React.CSSProperties;
  /** A 16–18px Lucide icon. */
  children?: React.ReactNode;
}

/** Square icon-only button for toolbars, table rows, headers. */
export function IconButton({ variant = "ghost", size = "md", label, children, style, onClick }: IconButtonProps) {
  return (
    <button
      type="button"
      className={`cl-iconbtn cl-iconbtn--${size} ${variant === "outline" ? "cl-iconbtn--outline" : ""}`}
      aria-label={label}
      title={label}
      style={style}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
