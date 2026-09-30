// Plain answers, with a smile (kit.faq.split). JEV ui.region_gate faq kept
// (2.00, container rows 0.70); ui.component_recipe kit.faq.split (0.20,
// low confidence, the top pick kept); tier 0. Nine short pairs as native
// details rows, each answer true to docs/architecture.md and the org rules
// in the API (a cat is let go after three failures in a row). Round C: the
// head stays beside the rows as they scroll by (landing.css), and the lead
// ends on the one next step for a question that is not here.
import { FAQ, type FAQItem } from "@mengai/ui";
import { ISSUES_URL, LICENSE_NAME, LICENSE_URL, PERMISSION_EMAIL, PERMISSION_MAILTO } from "../links";

export const QUESTIONS: FAQItem[] = [
  {
    q: "Do the cats need an OpenAI key?",
    a: "No. Any provider in the list works, or any OpenAI or Anthropic compatible endpoint, including Ollama and LM Studio on your Mac. You pick the model for every desk.",
  },
  {
    q: "What does a run cost?",
    a: "Only what your provider charges for the tokens. Every run has a budget, 400,000 tokens unless you change it, and you watch the spend as it happens. Oyen stops hiring before the budget runs thin.",
  },
  {
    q: "Will Oyen bother me all day?",
    a: "No. Oyen answers the crew and approves their requests on the spot. Only scope, credentials, money and anything you cannot undo come to you.",
  },
  {
    q: "What happens to a cat that keeps failing?",
    a: "After three failures in a row Oyen lets it go. Its open cards go back on the board, and the cat that takes them starts with everything the role has learned.",
  },
  {
    q: "Can the fund trade my real money?",
    a: "Not until you switch live trading on. Until then every order is paper, and each live order waits for your yes unless you set hard limits.",
  },
  {
    q: "Can I stop the cats halfway?",
    a: "Yes. Pause, stop or hit the kill switch at any time. A paused crew picks up from the step it was on, and nothing it did is lost.",
  },
  {
    q: "Can a cat touch my other files?",
    a: "No. The cats read, edit and run commands only inside the project folder you pick, never anywhere else on your machine.",
  },
  {
    q: "Does this website keep my keys or my runs?",
    a: "No. There are no accounts. The app in your browser talks straight to MengAI on your own machine, so keys, projects and runs never touch this website.",
  },
  {
    q: "Is it free, and can I read the code?",
    a: (
      <>
        Yes, for personal and noncommercial use. MengAI is source available under the <a href={LICENSE_URL}>{LICENSE_NAME}</a>: read every line, and
        teach the cats new tricks at home. Putting the crew to work for a business needs written permission first, from{" "}
        <a href={PERMISSION_MAILTO}>{PERMISSION_EMAIL}</a>.
      </>
    ),
  },
];

export function QuestionsSection() {
  return (
    <FAQ
      id="faq"
      tone="base"
      variant="split"
      title="Questions, answered plainly"
      lead={
        <>
          What people ask Oyen before their first run. Something else? <a href={ISSUES_URL}>Ask on GitHub</a>.
        </>
      }
      items={QUESTIONS}
    />
  );
}
