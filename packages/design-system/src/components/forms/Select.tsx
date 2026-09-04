"use client";

import React from "react";

export interface SelectProps {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  /** Strings or {value, label} pairs. */
  options: Array<string | { value: string; label: string }>;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  onChange?: (e: React.ChangeEvent) => void;
  style?: React.CSSProperties;
}

/** Native select styled to match Input, with chevron. */
export function Select({ label, hint, options = [], style, ...rest }: SelectProps) {
  const control = (
    <span className="cl-select">
      <select {...rest}>
        {options.map((o) =>
          typeof o === "string" ? (
            <option key={o} value={o}>{o}</option>
          ) : (
            <option key={o.value} value={o.value}>{o.label}</option>
          )
        )}
      </select>
      <span className="cl-select__chevron">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6"></path></svg>
      </span>
    </span>
  );
  if (!label && !hint) return <span style={style}>{control}</span>;
  return (
    <label className="cl-field" style={style}>
      {label ? <span className="cl-field__label">{label}</span> : null}
      {control}
      {hint ? <span className="cl-field__hint">{hint}</span> : null}
    </label>
  );
}
