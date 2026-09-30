---
id: design-system
name: Design system approach
version: 1
updated: 2026-09-30
focus: ui
summary: Tokens first, components built only from tokens, every state designed and dark mode as a real theme, all inside one design system.
roles: designer=3 engineer=1
kinds: studio
topics: token tokens theme theming dark system component components library palette color colors css variable tailwind style ui brand
---
- One design system per product. Reuse the project's tokens and components; extend them, never start a parallel set. Add no UI kit unless the owner asks.
- Tokens first: color, type, spacing, radius, motion and control height are named tokens (CSS variables or the theme file). Components use token names only, no raw hex or one-off px.
- Base when none exists: page #fafaf9, surface #ffffff, layers #f5f5f4 and #efefed, hairline #e5e5e3, control border #8f8e89, ink #1b1b1b, muted ink #474747, radius 8 for controls and 12 for cards, controls 44 px.
- Color roles, not colors: page, surface, layer, border, ink, muted, accent, and status colors only for real state, always with an icon or a word.
- Eight states per component: default, hover (hover devices only), focus-visible (instant outline), pressed, disabled, loading (width locked), error, success. Hover and pressed tint the fill, never lift it.
- One radius per component tier; nested corners stay concentric.
- Dark mode only as a deliberate theme: remap the same role tokens (warm near-black, near-white ink, never pure black or white), recompute tints, recheck contrast, never auto-switch unless the product ships it.
