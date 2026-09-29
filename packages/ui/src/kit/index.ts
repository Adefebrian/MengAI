// JAL Core composition kit. Every JAL page is composed from these; styles
// live in ../kit.css (import after tokens.css and ui.css). The identity
// model, the spacing ladder, the variants, the motion layer, and the page
// recipes are in skills/jal-design-system/references/identity.md.
export { Page, Section, SectionHead, Figure, DIRECTIONS, staggerStyle } from "./Page";
export type { PageProps, SectionProps, SectionHeadProps, FigureProps, SectionFrame, SectionTone, SectionRhythm, DirectionId } from "./Page";
export { Masthead } from "./Masthead";
export type { MastheadProps, MastheadVariant } from "./Masthead";
export { Split } from "./Split";
export type { SplitProps, SplitRatio, SplitVariant } from "./Split";
export { BentoGrid, BentoTile, validateBentoLayout, BENTO_PRESETS, bentoPreset } from "./Bento";
export type { BentoGridProps, BentoTileProps, BentoLayout, BentoKind } from "./Bento";
export { SpecRail, SpecTable } from "./Spec";
export type { SpecRailProps, SpecTableProps, SpecTableVariant, SpecRow, SpecGroup } from "./Spec";
export { StatRow } from "./StatRow";
export type { StatRowProps, StatRowVariant, Stat } from "./StatRow";
export { FeatureGrid } from "./FeatureGrid";
export type { FeatureGridProps, FeatureGridVariant, Feature } from "./FeatureGrid";
export { MediaFrame } from "./MediaFrame";
export type { MediaFrameProps, MediaRatio } from "./MediaFrame";
export { Quote } from "./Quote";
export type { QuoteProps, QuoteVariant, QuoteMetric } from "./Quote";
export { LogoRow } from "./LogoRow";
export type { LogoRowProps, Logo } from "./LogoRow";
export { FAQ } from "./FAQ";
export type { FAQProps, FAQVariant, FAQItem } from "./FAQ";
export { CTABand } from "./CTABand";
export type { CTABandProps, CTABandVariant } from "./CTABand";
export { PricingTable } from "./PricingTable";
export type { PricingTableProps, Plan, CompareRow } from "./PricingTable";
export { Footer } from "./Footer";
export type { FooterProps, FooterVariant, FooterLink } from "./Footer";
export { StickyStory, useStickyStory } from "./StickyStory";
export type { StickyStoryProps, StickyStoryVariant, StoryStep, StickyStoryState } from "./StickyStory";
export { validatePageRecipe, validateVarietyLedger, readPageLedger, toLedgerEntry, PAGE_RECIPES } from "./recipe";
export type { CompositionId, PageKind, LedgerEntry, RecipeEntry } from "./recipe";
export { armMotion, useKitMotion, motionTargets, onScreen, prefersReducedMotion, countUp, parseCountable, formatLike, standardCurve } from "./motion";
export type { MotionLevel, Countable } from "./motion";
