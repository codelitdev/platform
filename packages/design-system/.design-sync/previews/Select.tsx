import { Select } from "@codelitdev/design-system";

export function Basic() {
  return (
    <Select
      label="Audience"
      options={["Everyone", "Enrolled students", "Team only"]}
      defaultValue="Enrolled students"
      style={{ maxWidth: 280 }}
    />
  );
}

export function ObjectOptions() {
  return (
    <Select
      label="Sending domain"
      hint="Verified domains only."
      options={[
        { value: "mail.sendlit.com", label: "mail.sendlit.com" },
        { value: "updates.sendlit.com", label: "updates.sendlit.com" },
      ]}
      style={{ maxWidth: 280 }}
    />
  );
}
