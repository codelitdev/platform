import { Input } from "@codelitdev/design-system";

export function LabelAndHint() {
  return (
    <Input
      label="Course title"
      placeholder="e.g. Intro to TypeScript"
      hint="Shown on your public page."
      style={{ maxWidth: 320 }}
    />
  );
}

export function ErrorState() {
  return (
    <Input
      label="From address"
      defaultValue="not-an-email"
      error="That doesn't look like an email."
      style={{ maxWidth: 320 }}
    />
  );
}

export function Multiline() {
  return (
    <Input
      label="Description"
      multiline
      defaultValue="A hands-on course covering TypeScript fundamentals."
      style={{ maxWidth: 320 }}
    />
  );
}
