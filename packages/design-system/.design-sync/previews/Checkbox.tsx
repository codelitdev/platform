import { Checkbox } from "@codelitdev/design-system";

export function States() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Checkbox
        label="Send me a copy"
        description="One test email to your own inbox."
        defaultChecked
      />
      <Checkbox label="Subscribe to product updates" />
      <Checkbox label="Legacy opt-in" disabled />
    </div>
  );
}
