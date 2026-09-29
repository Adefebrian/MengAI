// @mengai/cats: the living cat character system. The contracts (props and
// handoffLayoutId in ./contract, the office scene in ./office-contract) are
// frozen; this package owns the rendering: a flat SVG rig, CSS keyframe
// loops on transform and opacity, a static pose per activity under reduced
// motion or `still`, and the Office scene, the living cat company.
import "./cats.css";

export * from "./contract";
export * from "./office-contract";
export { Cat } from "./cat";
export { CatCard } from "./card";
export { Office } from "./office/office";
