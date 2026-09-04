"use client";

import React from "react";

export interface SwitchProps {
  label?: React.ReactNode;
  checked?: boolean;
  defaultChecked?: boolean;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent) => void;
  style?: React.CSSProperties;
}

/** Toggle switch with trailing label. */
export function Switch({ label, checked, defaultChecked, disabled, onChange, style }: SwitchProps) {
  return (
    <label className="cl-switch" style={{ opacity: disabled ? 0.5 : 1, ...style }}>
      <input type="checkbox" role="switch" checked={checked} defaultChecked={defaultChecked} disabled={disabled} onChange={onChange} />
      <span className="cl-switch__track">
        <span className="cl-switch__thumb"></span>
      </span>
      {label ? <span>{label}</span> : null}
    </label>
  );
}
