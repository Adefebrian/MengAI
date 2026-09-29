// The MengAI mark: the official paw logo (packages/ui/src/brand, served at
// /brand/mengai-logo-192.png, drawn at 28 px) beside the wordmark. Used in
// the header and the footer. The image is decorative: the wordmark beside
// it (or the link's own name) carries the name.
export const LOGO_SRC = "/brand/mengai-logo-192.png";

export function Brand() {
  return (
    <span className="lp-mark">
      <img className="lp-mark-logo" src={LOGO_SRC} alt="" width={28} height={28} decoding="async" />
      <span className="lp-mark-word">MengAI</span>
    </span>
  );
}
