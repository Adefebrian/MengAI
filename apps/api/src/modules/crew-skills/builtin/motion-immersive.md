---
id: motion-immersive
name: Motion and immersive craft
version: 1
updated: 2026-09-30
focus: ui
summary: Purposeful motion on transform and opacity, scroll storytelling with GSAP or CSS, and 3D only with poster fallbacks, device tiers and reduced motion stills.
roles: designer=2 engineer=1
kinds: studio
topics: animation animate motion scroll transition 3d three webgl gsap parallax immersive interactive hero landing showcase canvas lenis framer
---
- Name the change an animation explains in one sentence, or cut it. Product UI motion is quiet; showcase pages may choreograph more.
- Transform and opacity only. 100 to 300 ms for UI, 400 to 600 ms only for showcase, one easing curve, exits about 70 percent of entrances, never transition: all.
- Smallest tool first: CSS, then the Web Animations API, then the project's motion library, then GSAP with ScrollTrigger for timelines and scroll scenes.
- Scroll stories: one continuous story, at most one pinned or scrubbed section per page, content readable without it, triggers refreshed after fonts and media load.
- Reduced motion: no travel, parallax or autoplay, just a still or a fade under 150 ms. Pending states use opacity so the page still renders without JavaScript.
- Loops over 5 s get a pause control; nothing flashes more than three times a second.
- 3D only when form, viewpoint or a transformation is the message: lazy loaded, a poster image first, the poster kept when WebGL is missing, the device is weak, data saver is on or motion is reduced.
- Device tiers: pixel ratio capped at 2 (lower on phones), fewer effects on coarse pointers and low memory, one canvas per page, dispose everything on unmount.
- In a canvas, natural light and soft contact shadows are fine; no bloom, glow or neon, and the page white shows through.
