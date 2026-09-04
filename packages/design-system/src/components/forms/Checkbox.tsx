"use client";

import React from "react";

export interface CheckboxProps {
  label?: React.ReactNode;
  /** Muted second line under the label. */
  description?: React.ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent) => void;
  style?: React.CSSProperties;
}

/** Checkbox with label and optional sub-description. */
export function Checkbox({ label, description, checked, defaultChecked, disabled, onChange, style }: CheckboxProps) {
  return (
    <label className={`cl-check ${disabled ? "cl-check--disabled" : ""}`} style={style}>
      <input type="checkbox" checked={checked} defaultChecked={defaultChecked} disabled={disabled} onChange={onChange} />
      <span className="cl-check__box">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6 9 17l-5-5"></path></svg>
      </span>
      {label ? (
        <span className="cl-check__label">
          {label}
          {description ? <span className="cl-check__sub">{description}</span> : null}
        </span>
      ) : null}
    </label>
  );
}
