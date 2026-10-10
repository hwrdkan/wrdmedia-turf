---
name: "Turf Studio"
description: "Portable workspace using the original visualization and configuration rules."
colors:
  forest: "#294f3d"
  paper: "#f6f4ef"
  ink: "#232e29"
  muted: "#58645e"
  line: "#d6dbd3"
  white: "#fff"
  focus: "#9c6c36"
  control-muted: "#5b655d"
  control-soft: "#f1efe7"
  empty: "#e9ede5"
  empty-ink: "#4b6050"
  error: "#b3261e"
typography:
  headline:
    fontFamily: "Saira Semi Condensed, Georgia, serif"
    fontSize: "clamp(30px,3.4vw,48px)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-.025em"
  title:
    fontFamily: "Saira Semi Condensed, Georgia, serif"
    fontSize: "26px"
    fontWeight: 700
  body:
    fontFamily: "Inter, Arial, sans-serif"
    fontSize: "15px"
    lineHeight: 1.6
rounded:
  button: "8px"
  panel: "12px"
  step: "14px"
  stage: "20px"
  pill: "999px"
  input: "10px"
spacing:
  control-gap: "8px"
  workspace-gap: "30px"
  compact-workspace-gap: "18px"
components:
  button-primary:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.white}"
    rounded: "{rounded.button}"
    padding: "10px 18px"
  control-panel:
    backgroundColor: "{colors.white}"
    rounded: "{rounded.panel}"
    padding: "12px 20px 20px"
  render-button:
    backgroundColor: "{colors.forest}"
    textColor: "{colors.white}"
    rounded: "{rounded.button}"
    height: "54px"
    width: "100%"
---
# Design System: Turf Studio

## Overview

**Creative North Star: "The Outdoor Design Workspace"**

A cream and forest workspace around the original rendering tool. The local interface inherits Inter for everyday controls and the original condensed Saira face for headings. Compact, readable controls support direct operation of the preview.

**Key Characteristics:**
- Preview-led operation.
- Cream surfaces and forest states.
- Bundled original font inheritance.

## Colors

Primary: forest carries actions and selected controls. Neutral: paper surrounds white panels; ink is the main text, muted supports labels, and line defines boundaries. Focus uses the observed warm brown outline. The inherited control-muted and control-soft colors remain distinct from the page shell. Error red is reserved for failed operations.

## Typography

Headlines use the bundled condensed face; controls and explanatory text use Inter. Retain the distinct font-family alias used by this export. Numeric dimensions in the pergola summary use tabular numerals.

## Layout

**The Preview First Rule.** Keep the visual output before its controls, with controls on the right at desktop width and below the output on mobile.

The shell caps at 1600px and uses 4vw horizontal padding. Desktop workspaces use a flexible preview with a 365px control rail. At 950px the rail narrows to 310px and the gap becomes compact. At 720px the workspace becomes one column with 20px page gutters. The stage is sticky at 20px on desktop and static on mobile. Inherited 900px, 600px, 560px and 480px rules additionally adjust internal controls and product details; local styles win where they override the inherited stylesheet.

## Elevation & Depth

The shell is flat. The inherited accordion uses a low shadow only for an open step. The comparison handle and switch thumb retain small functional shadows; selected turf cards deliberately suppress their inherited glow.

## Shapes

Rounded rectangles group controls and preview surfaces. Pill category chips, circular step numbers and the larger inherited stage radius remain part of the original photo workflow.

## Components

The primary render button fills its control rail. Category tabs use forest fill when selected. Accordion headers show a step number and choice summary; the open step hides its summary. Turf choices keep product thumbnails and a visible selected outline. Upload controls use a dashed boundary. Comparison imagery clips the after image behind a draggable handle.

Focus uses a 3px outline with a 3px offset for the page controls. The inherited putting-green switch retains its own forest focus treatment. Accordion and switch transitions use .2s ease; reduced motion disables transitions and the loading spinner.

## Do's and Don'ts

### Do:
- Do keep the preview first on phones and the controls to its right on desktop.
- Do retain the bundled font files and original renderer or photo workflow.
- Do use forest for action and selection states, with visible keyboard focus.

### Don't:
- Don’t replace product imagery, scene materials or renderer rules with decorative substitutes.
- Don’t introduce unrelated accent colors, gradients or ornamental shadows into the page shell.
- Don’t hide setup or reference limitations behind an active-looking promise.
