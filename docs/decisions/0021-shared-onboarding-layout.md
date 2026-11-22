# ADR 0021: Product onboarding shares a layout, not a wizard

Status: accepted  
Date: 2026-11-22

## Context

Every product needs a setup flow for new accounts. CourseLit built one first.
FrontLit and SendLit need the same kind of flow but haven't built theirs yet.
If each product copies CourseLit's, the three will drift apart in look and
behaviour, and fixes would have to be made three times.

CourseLit's onboarding has two kinds of code:

- **Layout and building blocks:** the top bar with the step indicator, the
  form pane with its button footer, the live-preview pane (a sheet on phones),
  field and note primitives, and the "welcome back" dialog. None of this
  depends on what is being set up.
- **The flow itself:** which steps exist, what they ask, the live previews,
  the AI panel, and how progress is saved through the product's API. This
  differs per product.

## Decision

- The layout and building blocks ship as three design-system registry items,
  installed like any other component (ADR 0020):
  - `onboarding-shell`: `OnboardingShell`, `OnboardingFooter`,
    `OnboardingPreview` and `PreviewBrowser`.
  - `onboarding-ui`: `StepHeader`, `FieldBlock`, `Hint`, `Note`, `Seg`, `Tile`,
    `ProgressList`, `DropZone`, `FileRow`, `CopyRow`, `StatusBadge`, `Spinner`
    and `useCopy`.
  - `onboarding-resume-dialog`: `OnboardingResumeDialog`.
- The shell holds no state. The product passes in its steps, the current step,
  the save status and the footer buttons, and keeps its own step machine,
  saving and previews.
- Colours come from design-system tokens only (`--success`, `--warning`,
  `--primary-soft` and so on), so each product's accent applies.
- No shared wizard engine, step registry or progress API. Revisit this only
  if FrontLit's and SendLit's flows turn out to repeat the same step logic,
  not just the layout.

## Consequences

- New onboarding in FrontLit and SendLit starts from
  `shadcn add @codelit/onboarding-shell @codelit/onboarding-ui
  @codelit/onboarding-resume-dialog`, and writes only its own steps.
- Layout fixes are made once in the platform and reach each product through a
  release and `shadcn add --overwrite`.
- A shared step, such as "how did you hear about us", can later ship as its own
  registry item built on `onboarding-ui`.
