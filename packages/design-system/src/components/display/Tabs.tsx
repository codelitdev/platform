"use client";

import React from "react";

export interface TabsProps {
  /** Tab labels; the label string is also the value. */
  tabs: string[];
  value?: string;
  defaultValue?: string;
  onChange?: (tab: string) => void;
  /** segmented = muted pill group; underline = accent underline row. */
  variant?: "segmented" | "underline";
  style?: React.CSSProperties;
}

/** Tab bar. Controlled via value/onChange or uncontrolled via defaultValue. */
export function Tabs({ tabs = [], value, defaultValue, onChange, variant = "segmented", style }: TabsProps) {
  const [internal, setInternal] = React.useState(defaultValue ?? tabs[0]);
  const active = value ?? internal;
  const pick = (t: string) => {
    setInternal(t);
    if (onChange) onChange(t);
  };
  return (
    <div className={`cl-tabs__list ${variant === "underline" ? "cl-tabs__list--underline" : ""}`} role="tablist" style={style}>
      {tabs.map((t) => (
        <button key={t} type="button" role="tab" className="cl-tabs__trigger" data-active={String(t === active)} onClick={() => pick(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}
