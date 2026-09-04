import { Toast } from "@codelitdev/design-system";

export function Variants() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <Toast
        variant="success"
        title="Course published"
        description="Students can enroll from your public page now."
      />
      <Toast variant="default" title="Draft saved" description="Auto-saved a minute ago." />
      <Toast
        variant="destructive"
        title="Delivery failed"
        description="Check your sending domain and try again."
      />
    </div>
  );
}
