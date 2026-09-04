"use client";

import React from "react";

export interface InputProps {
  label?: React.ReactNode;
  /** Helper text below the field; replaced by `error` when set. */
  hint?: React.ReactNode;
  /** Error message; also switches the border to destructive. */
  error?: React.ReactNode;
  /** Render a textarea instead. */
  multiline?: boolean;
  placeholder?: string;
  value?: string;
  defaultValue?: string;
  disabled?: boolean;
  type?: string;
  onChange?: (e: React.ChangeEvent) => void;
  style?: React.CSSProperties;
}

/** Text input (or textarea via multiline) with optional label, hint, and error. */
export function Input({ label, hint, error, multiline, style, ...rest }: InputProps) {
  const cls = `cl-input ${error ? "cl-input--invalid" : ""}`;
  const control = multiline ? (
    <textarea className={cls} {...rest} />
  ) : (
    <input className={cls} {...rest} />
  );
  if (!label && !hint && !error) return control;
  return (
    <label className="cl-field" style={style}>
      {label ? <span className="cl-field__label">{label}</span> : null}
      {control}
      {error ? (
        <span className="cl-field__error">{error}</span>
      ) : hint ? (
        <span className="cl-field__hint">{hint}</span>
      ) : null}
    </label>
  );
}
