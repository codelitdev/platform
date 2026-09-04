"use client";

import React from "react";

export interface ButtonProps {
  /** Visual style. `soft` is the accent-wash variant unique to CodeLit. */
  variant?: "primary" | "secondary" | "outline" | "ghost" | "soft" | "destructive";
  size?: "sm" | "md" | "lg";
  disabled?: boolean;
  type?: "button" | "submit";
  onClick?: () => void;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/** Primary action affordance. Variants: primary, secondary, outline, ghost, soft, destructive. */
export function Button({ variant = "primary", size = "md", disabled, children, style, onClick, type = "button" }: ButtonProps) {
  return (
    <button
      type={type}
      className={`cl-btn cl-btn--${variant} cl-btn--${size}`}
      disabled={disabled}
      style={style}
      onClick={onClick}
    >
      {children}
    </button>
  );
}
