---
id: design-law
name: Design law and tidiness
version: 1
updated: 2026-09-30
focus: ui
summary: The visual law for every screen: nothing overlapping, clipped or left as an empty gap, white-first flat surfaces, 44 px targets, mobile first and reduced motion.
roles: designer=3 engineer=2 reviewer=2 qa=2
kinds: studio
topics: ui ux page landing site website app frontend css style layout component design hero dashboard form button mobile responsive theme html react screen visual halaman tampilan aplikasi situs desain
---
Every screen, any stack. An explicit owner request beats a default here.
- Tidy first: nothing overlaps a sibling (only dialogs, menus, tooltips and popovers stack, in their own layer), no child pokes out of its parent, stacked regions share one left and right edge.
- No clipped text: truncate only on purpose, with an ellipsis and the full value reachable.
- No empty gaps: no dead grid cells, no void inside a card, no rows stretched to fill height.
- Fit 320 px, mobile first: minmax(0, 1fr) tracks, min-width: 0 on grid and flex children, border-box, no fixed width wider than the screen, no sideways scroll at any width.
- White-first and flat: a white or near-white page, dark only as a theme the owner asked for. No gradients, glow, neon or blurred shadows; depth is a tonal step plus a 1 px hairline.
- No decorative lines: no side or top accent stripes, connector lines, marker dots or tab underlines. Selection is a full ring or a tonal fill.
- One restrained accent at most, never purple, violet or indigo. Primary action: ink on white.
- No emoji and no em-dash in copy. Icons are SVG from one family.
- Controls and targets 44 px, 8 px apart, control borders at 3:1 contrast. Text 12 px at least, inputs 16 px, AA contrast, a visible focus outline.
- Motion only to explain a change; honor prefers-reduced-motion.
- Run ui_check before you finish UI work and fix every finding.
