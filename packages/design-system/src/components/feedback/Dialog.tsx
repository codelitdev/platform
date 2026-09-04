"use client";

import React from "react";

export interface DialogProps {
  open: boolean;
  onClose?: () => void;
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Right-aligned action row; defaults to Cancel/Confirm. */
  footer?: React.ReactNode;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}
import { Button } from "../actions/Button";

/** Modal dialog with scrim. Controlled: open + onClose. */
export function Dialog({ open, onClose, title, description, footer, children, style }: DialogProps) {
  if (!open) return null;
  return (
    <div className="cl-dialog__scrim" onClick={onClose}>
      <div className="cl-dialog" role="dialog" aria-modal="true" style={style} onClick={(e) => e.stopPropagation()}>
        {title ? <h2 className="cl-dialog__title">{title}</h2> : null}
        {description ? <p className="cl-dialog__description">{description}</p> : null}
        {children}
        <div className="cl-dialog__footer">
          {footer ?? (
            <React.Fragment>
              <Button variant="outline" onClick={onClose}>Cancel</Button>
              <Button onClick={onClose}>Confirm</Button>
            </React.Fragment>
          )}
        </div>
      </div>
    </div>
  );
}
