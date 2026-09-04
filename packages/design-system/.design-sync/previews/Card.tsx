import { Card, Button, Input } from "@codelitdev/design-system";

export function WithFooter() {
  return (
    <Card
      title="Course details"
      description="Shown on your public page."
      footer={<Button>Save changes</Button>}
      style={{ width: 320 }}
    >
      <Input label="Course title" defaultValue="Intro to TypeScript" />
    </Card>
  );
}

export function PlainSurface() {
  return (
    <Card style={{ maxWidth: 360 }}>
      <p style={{ margin: 0 }}>
        A plain surface with just <code>children</code> — no header or footer.
      </p>
    </Card>
  );
}
