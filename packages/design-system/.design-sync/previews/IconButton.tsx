import { IconButton } from "@codelitdev/design-system";
import { Copy, Trash2, Pencil } from "lucide-react";

export function Variants() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <IconButton label="Copy URL">
        <Copy size={16} />
      </IconButton>
      <IconButton label="Edit" variant="outline">
        <Pencil size={16} />
      </IconButton>
      <IconButton label="Delete" variant="ghost">
        <Trash2 size={16} />
      </IconButton>
    </div>
  );
}

export function Sizes() {
  return (
    <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
      <IconButton label="Copy URL" size="md">
        <Copy size={16} />
      </IconButton>
      <IconButton label="Copy URL" size="sm">
        <Copy size={16} />
      </IconButton>
    </div>
  );
}
