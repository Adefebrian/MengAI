// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
// @mengai/cats: the living cat character system. The contracts (props and
// handoffLayoutId in ./contract, the office scene in ./office-contract) are
// frozen; this package owns the rendering: a flat SVG rig, CSS keyframe
// loops on transform and opacity, a static pose per activity under reduced
// motion or `still`, and the Office scene, the living cat company (a
// software studio or a hedge fund trading floor, see office/office.tsx), and
// the shared crew roster (roster.ts) so one name always wears one coat.
import "./cats.css";

export * from "./contract";
export * from "./office-contract";
export * from "./tracker-contract";
export { Cat } from "./cat";
export { CatCard } from "./card";
export { Office, type OfficeClock } from "./office/office";
export { CEO_COAT, CEO_NAME, ROSTER, crewLooks, lookFor, rosterCat, rosterCrew, type RosterCat } from "./roster";
export { DeliveryTracker } from "./tracker/tracker";
