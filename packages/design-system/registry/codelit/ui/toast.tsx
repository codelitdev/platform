import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { InfoIcon, CheckCircle2Icon, AlertCircleIcon } from "lucide-react";

import { cn } from "@/lib/utils";

// CodeLit toast — mirrors `.cl-toast`. A presentational notification card; render
// it inside your app's toast stack / a fixed bottom-right region. For a full
// toaster, drive these with your queue of choice (e.g. sonner) or render directly.
const toastIconVariants = cva("mt-0.5 flex shrink-0 [&_svg]:size-4", {
    variants: {
        variant: {
            default: "text-primary",
            success: "text-[var(--success)]",
            destructive: "text-destructive",
        },
    },
    defaultVariants: { variant: "default" },
});

const icons = {
    default: InfoIcon,
    success: CheckCircle2Icon,
    destructive: AlertCircleIcon,
} as const;

function Toast({
    className,
    variant = "default",
    title,
    description,
    icon,
    ...props
}: Omit<React.ComponentProps<"div">, "title"> &
    VariantProps<typeof toastIconVariants> & {
        title?: React.ReactNode;
        description?: React.ReactNode;
        icon?: React.ReactNode;
    }) {
    const Icon = icons[variant ?? "default"];
    return (
        <div
            data-slot="toast"
            role="status"
            className={cn(
                "flex w-[340px] items-start gap-3 rounded-[var(--radius-lg)] border bg-popover p-[14px_16px] text-popover-foreground shadow-[var(--shadow-popover)]",
                className,
            )}
            {...props}
        >
            <span className={cn(toastIconVariants({ variant }))}>
                {icon ?? <Icon />}
            </span>
            <div className="min-w-0 flex-1">
                {title && (
                    <p className="text-sm font-semibold">{title}</p>
                )}
                {description && (
                    <p className="mt-0.5 text-xs text-muted-foreground">
                        {description}
                    </p>
                )}
            </div>
        </div>
    );
}

export { Toast };
