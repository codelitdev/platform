import React from "react";

export interface CardProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Rendered in a flex footer row with 10px gap. */
  footer?: React.ReactNode;
  style?: React.CSSProperties;
  children?: React.ReactNode;
}

/** Content surface. Compose with CardHeader/CardContent/CardFooter or use title/description shorthand. */
export function Card({ title, description, footer, children, style }: CardProps) {
  return (
    <div className="cl-card" style={style}>
      {title || description ? (
        <div className="cl-card__header">
          {title ? <h3 className="cl-card__title">{title}</h3> : null}
          {description ? <p className="cl-card__description">{description}</p> : null}
        </div>
      ) : null}
      {children != null ? <div className="cl-card__content">{children}</div> : null}
      {footer ? <div className="cl-card__footer">{footer}</div> : null}
    </div>
  );
}
