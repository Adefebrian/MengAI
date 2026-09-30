---
id: frontend-rules
name: Frontend rules
version: 1
updated: 2026-09-30
focus: ui
summary: Accessibility, semantic HTML, a performance budget, images and forms done right, in whatever frontend stack the project uses.
roles: engineer=2 designer=2 reviewer=1 qa=1
kinds: studio
topics: frontend html css react vue svelte page form image accessibility a11y performance seo component ui site website app mobile responsive halaman aplikasi situs
---
- Use the project's framework and conventions; when nothing is set, suggest React with TypeScript on Bun.
- Semantic HTML: landmarks, one h1, headings in order, buttons for actions, links for navigation, real lists and tables.
- Accessible: visible labels, full keyboard use in a sensible order, visible focus, color never the only signal, aria-label on icon-only buttons, dialogs trap and return focus.
- Forms: label above, every control one 44 px height and one border style, 16 px input text, reserved helper and error rows so validation never shifts layout, right input types and autocomplete.
- Images: width and height or aspect-ratio, alt text (empty for decoration), modern formats, lazy below the fold, the hero image eager.
- Budget: LCP under 2.5 s, CLS under 0.1, INP under 200 ms. Little JavaScript, split heavy routes, self-hosted fonts with fallbacks.
- Layout: min-width media queries, 100dvh over 100vh, safe-area insets on fixed bars, a sticky header and bottom tab bar on phone app screens.
- Every async view handles loading, empty and error; long words wrap; changing numbers use tabular-nums.
