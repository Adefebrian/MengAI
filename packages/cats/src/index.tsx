// Placeholder until the cats workstream lands. Keeps apps/web building.
import type { CatCardProps, CatProps } from "./contract";
export * from "./contract";

export function Cat(props: CatProps) {
  return <span role="img" aria-label={props.label} data-cat-status={props.status} />;
}

export function CatCard(props: CatCardProps) {
  return (
    <div data-cat-card={props.name}>
      <Cat {...props} />
      <span>{props.name}</span>
    </div>
  );
}
