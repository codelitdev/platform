"use client";

import React from "react";

export interface RadioProps {
  label?: React.ReactNode;
  description?: React.ReactNode;
  name?: string;
  value?: string;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent) => void;
  style?: React.CSSProperties;
}

/** Radio button; group by sharing `name`. */
export function Radio({ label, description, name, value, checked, defaultChecked, disabled, onChange, style }: RadioProps) {
  return (
    <label className={`cl-check ${disabled ? "cl-check--disabled" : ""}`} style={style}>
      <input type="radio" name={name} value={value} checked={checked} defaultChecked={defaultChecked} disabled={disabled} onChange={onChange} />
      <span className="cl-check__box cl-check__box--radio">
        <span className="cl-check__radio-dot"></span>
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
