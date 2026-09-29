// The two system glyphs the kit needs by default, reused from the JAL Core
// control set in ui.css (the select chevron and the checkbox check), so no
// third icon voice appears. Any other icon comes from koboyo first, then
// reicon.dev, through <Icon>; FAQ and PricingTable accept a replacement.
export function ChevronGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 8" fill="none" aria-hidden="true" focusable="false">
      <path d="M1.5 1.75L6 6.25L10.5 1.75" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CheckGlyph({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 12 12" fill="none" aria-hidden="true" focusable="false">
      <path d="M2 6.25L4.75 9L10 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
