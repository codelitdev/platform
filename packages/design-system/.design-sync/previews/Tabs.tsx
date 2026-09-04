import { Tabs } from "@codelitdev/design-system";

export function Segmented() {
  return <Tabs tabs={["Overview", "Students", "Settings"]} defaultValue="Overview" />;
}

export function Underline() {
  return (
    <Tabs tabs={["Overview", "Students", "Settings"]} variant="underline" defaultValue="Students" />
  );
}
