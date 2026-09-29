// @mengai/cats: the living cat character system. The contract (props and
// handoffLayoutId) is frozen in ./contract; this package owns the rendering:
// a flat SVG rig, CSS keyframe loops on transform and opacity, and a static
// pose per activity under reduced motion or `still`.
import "./cats.css";

export * from "./contract";
export { Cat } from "./cat";
export { CatCard } from "./card";
