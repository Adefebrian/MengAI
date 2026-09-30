// Copyright 2026 Adefebrian (https://adefebrian.com). Built by Adefebrian. Noncommercial use only, see LICENSE.
// SPDX-License-Identifier: PolyForm-Noncommercial-1.0.0
import { afterEach, describe, expect, test } from "bun:test";
import { act } from "react";
import { ACTIVITY_LABEL, ROLE_LABEL, STATUS_LABEL } from "@mengai/shared";
import { CatCard, type CatCardProps } from "./index";
import { emulateReducedMotion, motionClasses, mount, type Mounted } from "./test-kit";

function card(over: Partial<CatCardProps> = {}): CatCardProps {
  return {
    look: { coat: "tuxedo", seed: 42 },
    role: "lead",
    status: "working",
    activity: "plan",
    mood: "focused",
    label: "Kopi, Lead, planning",
    name: "Kopi",
    statusText: "Splitting the goal into tasks",
    taskTitle: "Plan the landing page rewrite",
    energy: 0.42,
    ...over,
  };
}

let mounted: Mounted | null = null;
let restore: (() => void) | null = null;
afterEach(() => {
  mounted?.unmount();
  mounted = null;
  restore?.();
  restore = null;
});

describe("CatCard", () => {
  test("shows the cat on its cushion, name, role, status, task and energy used", () => {
    mounted = mount(<CatCard {...card()} />);
    const host = mounted.host;
    expect(host.querySelector(".cat-card")?.tagName).toBe("ARTICLE");
    expect(host.querySelector(".c-cushion")).not.toBeNull();
    expect(host.querySelector(".cat-card-name")?.textContent).toBe("Kopi");
    expect(host.querySelector(".cat-card-role")?.textContent).toBe(ROLE_LABEL.lead);
    expect(host.querySelector(".cat-card-state")?.textContent).toBe(STATUS_LABEL.working);
    expect(host.querySelector(".cat-card-detail")?.textContent).toBe("Splitting the goal into tasks");
    expect(host.querySelector(".cat-card-task")?.textContent).toBe("Plan the landing page rewrite");
    expect(host.querySelector(".cat-card-meter-label")?.textContent).toBe("Energy used");
    expect(host.querySelector(".cat-card-meter-value")?.textContent).toBe("42%");
    expect(host.querySelector(".cat-card-fill")?.getAttribute("style")).toContain("--cat-energy: 0.42");
    expect(host.querySelector(".cat-card")?.getAttribute("aria-label")).toBe("Kopi, Lead, planning");
  });

  test("falls back to the activity words and an empty task line", () => {
    mounted = mount(<CatCard {...card({ statusText: null, taskTitle: null, activity: "read", status: "working" })} />);
    expect(mounted.host.querySelector(".cat-card-detail")?.textContent).toBe(ACTIVITY_LABEL.read);
    const task = mounted.host.querySelector(".cat-card-task")!;
    expect(task.textContent).toBe("No task yet");
    expect(task.hasAttribute("data-empty")).toBe(true);
  });

  test("status words are not repeated when the detail says the same", () => {
    mounted = mount(<CatCard {...card({ statusText: "Working" })} />);
    expect(mounted.host.querySelector(".cat-card-detail")).toBeNull();
  });

  test("energy is clamped to 0..100 percent", () => {
    for (const [energy, text] of [
      [1.7, "100%"],
      [-0.3, "0%"],
      [Number.NaN, "0%"],
      [0.005, "1%"],
    ] as const) {
      mounted = mount(<CatCard {...card({ energy })} />);
      expect(mounted.host.querySelector(".cat-card-meter-value")?.textContent).toBe(text);
      mounted.unmount();
      mounted = null;
    }
  });

  test("near the budget limit the meter says so and the cat turns tired", () => {
    mounted = mount(<CatCard {...card({ energy: 0.92 })} />);
    expect(mounted.host.querySelector(".cat-card-meter-low")?.textContent).toBe("Running low");
    expect(mounted.host.querySelector(".cat-card")?.getAttribute("data-energy")).toBe("low");
    expect(mounted.host.querySelector(".cat")?.getAttribute("data-energy")).toBe("low");
    mounted.render(<CatCard {...card({ energy: 0.4 })} />);
    expect(mounted.host.querySelector(".cat-card-meter-low")).toBeNull();
    expect(mounted.host.querySelector(".cat")?.hasAttribute("data-energy")).toBe(false);
  });

  test("the cat keeps its reserved square: the card carries its size", () => {
    for (const size of [48, 64, 96, 160] as const) {
      mounted = mount(<CatCard {...card({ size })} />);
      expect(mounted.host.querySelector(".cat-card")?.getAttribute("data-size")).toBe(String(size));
      expect(mounted.host.querySelector(".cat-card-media svg")?.getAttribute("width")).toBe(String(size));
      mounted.unmount();
      mounted = null;
    }
  });

  test("selectable: one button hit target, selection as a pressed state", () => {
    let picks = 0;
    mounted = mount(<CatCard {...card({ onSelect: () => picks++, selected: true, interactive: true })} />);
    const buttons = mounted.host.querySelectorAll("button");
    expect(buttons.length).toBe(1);
    const button = buttons[0]!;
    expect(button.classList.contains("cat-card")).toBe(true);
    expect(button.getAttribute("aria-pressed")).toBe("true");
    expect(button.hasAttribute("data-selected")).toBe(true);
    const described = (button.getAttribute("aria-describedby") ?? "").split(" ");
    expect(described.length).toBe(3);
    for (const id of described) expect(mounted.host.ownerDocument.getElementById(id)).not.toBeNull();
    act(() => button.click());
    expect(picks).toBe(1);
  });

  test("the cat inside a card is never a second button", () => {
    mounted = mount(<CatCard {...card({ onSelect: () => {} })} />);
    expect(mounted.host.querySelector(".cat")?.tagName).toBe("SPAN");
    expect(mounted.host.querySelector(".cat-caption")).toBeNull();
  });

  test("reduced motion: the card cat carries no animation class", () => {
    restore = emulateReducedMotion(true);
    mounted = mount(<CatCard {...card({ interactive: true, onSelect: () => {}, celebrateKey: 2 })} />);
    expect(motionClasses(mounted.host)).toEqual([]);
  });
});
