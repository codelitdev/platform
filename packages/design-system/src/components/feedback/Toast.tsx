import React from "react";

export interface ToastProps {
  variant?: "default" | "success" | "destructive";
  title?: React.ReactNode;
  description?: React.ReactNode;
  style?: React.CSSProperties;
}

const icons = {
  default: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 16v-4"></path><path d="M12 8h.01"></path></svg>,
  success: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="m9 12 2 2 4-4"></path></svg>,
  destructive: <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="10"></circle><path d="M12 8v4"></path><path d="M12 16h.01"></path></svg>,
};

/** Notification card. Render inside a fixed bottom-right stack in real apps. */
export function Toast({ variant = "default", title, description, style }: ToastProps) {
  return (
    <div className={`cl-toast cl-toast--${variant}`} style={style}>
      <span className="cl-toast__icon">{icons[variant] ?? icons.default}</span>
      <div>
        {title ? <p className="cl-toast__title">{title}</p> : null}
        {description ? <p className="cl-toast__description">{description}</p> : null}
      </div>
    </div>
  );
}
