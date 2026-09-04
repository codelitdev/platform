import { Radio } from "@codelitdev/design-system";

export function Group() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <Radio name="visibility" label="Public" defaultChecked />
      <Radio
        name="visibility"
        label="Unlisted"
        description="Only people with the link."
      />
      <Radio name="visibility" label="Private" disabled />
    </div>
  );
}
