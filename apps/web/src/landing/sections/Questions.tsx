// Plain answers (kit.faq.open, JEV 0.89; tier 0): six short pairs, every
// answer visible, each one true to docs/architecture.md.
import { FAQ, type FAQItem } from "@mengai/ui";

export const QUESTIONS: FAQItem[] = [
  {
    q: "Do I need an OpenAI key?",
    a: "No. Use a key from any provider in the list, or point MengAI at any OpenAI or Anthropic compatible endpoint, including Ollama and LM Studio on your Mac.",
  },
  {
    q: "What does a run cost?",
    a: "Only what your provider charges for the tokens. Every run has a budget, 400,000 tokens unless you change it, and the app shows the spend as it happens.",
  },
  {
    q: "When does a cat ask me?",
    a: "Only when Kopi should not decide alone. Kopi answers the crew and approves their requests; a question only you can answer comes to you.",
  },
  {
    q: "Can I stop a run halfway?",
    a: "Yes. Pause, stop or use the kill switch at any time. A paused crew picks up from the step it was on, and nothing it did is lost.",
  },
  {
    q: "Can it touch other files?",
    a: "No. The cats read, edit and run commands only inside the project folder you pick, never anywhere else on your machine.",
  },
  {
    q: "Is it really open source?",
    a: "Yes, under Apache-2.0. Run it on your Mac or on your own server, read every line and change what you like.",
  },
];

export function QuestionsSection() {
  return <FAQ id="faq" tone="base" variant="open" title="Plain answers" lead="What people ask before they start their first run." items={QUESTIONS} />;
}
