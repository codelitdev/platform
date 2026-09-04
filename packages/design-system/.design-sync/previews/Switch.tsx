import { Switch } from "@codelitdev/design-system";

export function States() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Switch label="Auto-publish new lessons" defaultChecked />
      <Switch label="Weekly digest email" />
      <Switch label="Legacy setting" disabled />
    </div>
  );
}
