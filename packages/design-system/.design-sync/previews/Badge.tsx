import { Badge } from "@codelitdev/design-system";

export function Variants() {
  return (
    <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
      <Badge variant="default" dot>
        Published
      </Badge>
      <Badge variant="neutral">Draft</Badge>
      <Badge variant="success" dot>
        Delivered
      </Badge>
      <Badge variant="warning">Needs review</Badge>
      <Badge variant="destructive">Bounced</Badge>
      <Badge variant="outline">Archived</Badge>
    </div>
  );
}
