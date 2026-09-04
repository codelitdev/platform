import { Button } from "@codelitdev/design-system";

export function Variants() {
  return (
    <div style={{ display: "flex", gap: 12, flexWrap: "wrap", alignItems: "center" }}>
      <Button variant="primary">Create course</Button>
      <Button variant="secondary">Cancel</Button>
      <Button variant="outline">Preview</Button>
      <Button variant="ghost">Skip</Button>
      <Button variant="soft">Learn more</Button>
      <Button variant="destructive">Delete campaign</Button>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <Button size="sm">Small</Button>
      <Button size="md">Medium</Button>
      <Button size="lg">Large</Button>
    </div>
  );
}

export function Disabled() {
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <Button variant="primary" disabled>
        Create course
      </Button>
      <Button variant="outline" disabled>
        Preview
      </Button>
    </div>
  );
}
