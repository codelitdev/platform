import { Dialog, Button } from "@codelitdev/design-system";

export function Confirm() {
  return (
    <Dialog
      open
      title="Delete campaign?"
      description="This can't be undone."
      footer={
        <>
          <Button variant="outline">Keep it</Button>
          <Button variant="destructive">Delete campaign</Button>
        </>
      }
    />
  );
}
