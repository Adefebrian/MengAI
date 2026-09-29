// Privacy and security (kit.feature-grid.cells, JEV 0.96; tier 1): six
// equivalent safeguards in the hairline cell grid, an inline icon on each
// title row. Every line restates docs/architecture.md, nothing more.
import { FeatureGrid, type Feature } from "@mengai/ui";
import { EyeSlashIcon, FolderLockIcon, KeyIcon, ShieldIcon, StopCircleIcon, TerminalIcon } from "../icons";

export const SAFEGUARDS: Feature[] = [
  {
    title: "Keys never leave the vault",
    body: "Stored in the macOS Keychain or sealed on your server, and sent only inside the request to your provider.",
    icon: <KeyIcon size={20} color="currentColor" />,
  },
  {
    title: "Scrubbed from every output",
    body: "Tool results and logs are checked against your key fingerprints before any cat, or the page, sees them.",
    icon: <EyeSlashIcon size={20} color="currentColor" />,
  },
  {
    title: "Jailed to your project",
    body: "Files and commands stay inside the project folder: a macOS sandbox on the Mac, the container on your server, each with a scrubbed environment.",
    icon: <FolderLockIcon size={20} color="currentColor" />,
  },
  {
    title: "A budget on every run",
    body: "Each run stops at 400,000 tokens unless you change it, and guards end loops that stop making progress.",
    icon: <ShieldIcon size={20} color="currentColor" />,
  },
  {
    title: "Stop everything at once",
    body: "Pause, stop, or hit the kill switch: calls in flight and the processes they started end right away.",
    icon: <StopCircleIcon size={20} color="currentColor" />,
  },
  {
    title: "Local on the Mac",
    body: "The Mac app listens only on 127.0.0.1 and opens with a one-time launch token, so nothing else on the network can reach it.",
    icon: <TerminalIcon size={20} color="currentColor" />,
  },
];

export function SecuritySection() {
  return (
    <FeatureGrid
      id="security"
      tone="layer"
      variant="cells"
      columns={3}
      title="Your code, your keys, your budget"
      lead="The crew works for you inside limits you can read. Nothing leaves your machine except the requests to the provider you picked."
      items={SAFEGUARDS}
    />
  );
}
