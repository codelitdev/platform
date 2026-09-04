import { Tooltip, IconButton } from "@codelitdev/design-system";
import { Copy } from "lucide-react";

export function Open() {
  return (
    <div style={{ display: "flex", justifyContent: "center", paddingTop: 40, paddingLeft: 80, paddingRight: 80 }}>
      <Tooltip label="Copy upload URL" open>
        <IconButton label="Copy">
          <Copy size={16} />
        </IconButton>
      </Tooltip>
    </div>
  );
}
