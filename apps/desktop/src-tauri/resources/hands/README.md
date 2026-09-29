The macOS automation helper (services/hands) is copied here as
`mengai-hands` by `apps/desktop/scripts/build.ts` when it has been built.
Until then this placeholder keeps the bundle resource path valid, and the
API reports automation as unavailable because MENGAI_HANDS_BIN does not
exist.
