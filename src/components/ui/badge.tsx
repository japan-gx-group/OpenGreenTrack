import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "cn"
import { Slot } from "radix-ui"

// shadcn/ui の Badge を globals.css の gt-pill / gt-pill-* と同じ見た目に合わせたもの。
// variant は意味色で指定する（旧 .badge-* と同じ名前なので呼び出し側はそのまま）。
const badgeVariants = cva(
  "group/badge inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent whitespace-nowrap font-semibold transition-colors focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3!",
  {
    variants: {
      variant: {
        neutral: "bg-muted text-muted-foreground",
        success: "bg-success-soft text-success",
        warning: "bg-warning-soft text-warning",
        danger: "bg-danger-light text-danger",
        info: "bg-info-soft text-info",
        accent: "bg-primary-light text-primary-dark",
        outline: "border-border text-foreground",
      },
      size: {
        default: "h-6 px-[9px] text-xs",
        sm: "h-[22px] px-[9px] text-[11.5px]",
      },
    },
    defaultVariants: {
      variant: "neutral",
      size: "sm",
    },
  }
)

function Badge({
  className,
  variant = "neutral",
  size = "sm",
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : "span"

  return (
    <Comp
      data-slot="badge"
      data-variant={variant}
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
