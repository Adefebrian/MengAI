// Kit preview, page A: a tidy product landing composed only from the kit,
// with the kit's own zero-dependency motion (quiet entrances, count-up).
// Sample product and sample content (a desk air monitor); not the app's
// starter page and never shipped as one.
//
// Ledger (composition.variant, in ledgers.ts, validated in kit.test.tsx):
//   masthead.split, logo-row.row, split.inset, stat-row.lead,
//   sticky-story.stage-end, bento.lead-right, feature-grid.rows,
//   quote.results, spec-table.grouped, pricing.cells-compare, faq.open,
//   cta-band.form, footer.inline
import { AppShell } from "../../AppShell";
import {
  BentoGrid,
  BentoTile,
  CTABand,
  FAQ,
  FeatureGrid,
  Footer,
  LogoRow,
  Masthead,
  MediaFrame,
  Page,
  PricingTable,
  Quote,
  SpecRail,
  SpecTable,
  Split,
  StatRow,
  StickyStory,
  type DirectionId,
} from "../index";
import { ContrastView, DayReadout, EventLog, SensorGrid, WeekStrip } from "./art";


const destinations = [
  { id: "top", label: "Overview", href: "#top" },
  { id: "story", label: "Story", href: "#story" },
  { id: "specs", label: "Specs", href: "#specs" },
  { id: "pricing", label: "Pricing", href: "#pricing" },
];

export function Landing({ direction }: { direction: DirectionId }) {
  return (
    <Page direction={direction} theme={direction === "D13" ? "dark" : undefined} rhythm="default" motion="quiet">
      <AppShell title="Hawa" destinations={destinations} current="top" actions={<a className="btn" href="#pricing">Buy</a>}>
        <Masthead
          id="top"
          variant="split"
          title="Air you can read."
          lead="A desk monitor that turns CO2, fine dust, and humidity into one plain sentence about the room you are in."
          actions={
            <>
              <a className="btn" href="#pricing">
                Buy Hawa One
              </a>
              <a className="btn btn-secondary" href="#story">
                See how it works
              </a>
            </>
          }
          media={
            <MediaFrame kind="view" ratio="4/3" tone="surface" caption="Live readout from a sample desk, updated every minute.">
              <DayReadout />
            </MediaFrame>
          }
        />

        <LogoRow
          label="Works with the home you already have"
          logos={[{ name: "Matter" }, { name: "Apple Home" }, { name: "Google Home" }, { name: "Home Assistant" }]}
        />

        <Split
          tone="layer"
          variant="inset"
          ratio="5/7"
          mediaSide="start"
          title="It reads the room, not the city."
          lead="Weather apps report the air outside. Hawa measures the air at your desk, where a closed door and four people can double the CO2 in an hour."
          media={
            <MediaFrame kind="view" ratio="16/9" tone="surface" caption="The same afternoon, measured outside and at one desk.">
              <ContrastView />
            </MediaFrame>
          }
        >
          <SpecRail
            label="Sensors"
            rows={[
              { label: "CO2", value: "±30", unit: "ppm", note: "NDIR sensor" },
              { label: "Fine dust", value: "0 to 500", unit: "µg/m³", note: "PM2.5, laser" },
              { label: "Temperature", value: "±0.3", unit: "°C" },
            ]}
          />
        </Split>

        <StatRow
          variant="lead"
          title="Small numbers, on purpose."
          lead="Every figure is one you can check against the datasheet below. None of them needs an account to see."
          stats={[
            { value: "±30", unit: "ppm", caption: "CO2 accuracy from 400 to 2000 ppm.", signal: true },
            { value: "18", unit: "months", caption: "On one charge at a reading a minute." },
            { value: "180", unit: "g", caption: "Light enough for the next meeting room." },
            { value: "2", unit: "min", caption: "From the box to the first reading." },
          ]}
        />

        <StickyStory
          id="story"
          variant="stage-end"
          title="From a number to a decision."
          lead="Hawa does three things, in the order you need them."
          steps={[
            {
              title: "It measures",
              body: "Every minute Hawa reads CO2, fine dust, temperature, and humidity, and shows the one that matters most right now.",
              media: (
                <MediaFrame kind="view" ratio="16/9" tone="surface">
                  <SensorGrid />
                </MediaFrame>
              ),
            },
            {
              title: "It explains",
              body: "The day view shows when the air turned, so the 3 pm slump has a cause you can see: the meeting room door.",
              media: (
                <MediaFrame kind="view" ratio="4/3" tone="surface">
                  <DayReadout />
                </MediaFrame>
              ),
            },
            {
              title: "It tells you what to do",
              body: "Above 1000 ppm the display says what fixes it, in plain words, and goes quiet again once the room recovers.",
              media: (
                <MediaFrame kind="view" ratio="16/9" tone="surface">
                  <EventLog />
                </MediaFrame>
              ),
            },
          ]}
        />

        <BentoGrid tone="layer" preset="lead-right" title="A week on one desk." lead="What a single Hawa learned about one room.">
          <BentoTile area="a" kind="stat" value="612" unit="ppm" body="Right now, fine for focus." signal />
          <BentoTile area="b" kind="text" title="No fan, no hum" body="Passive airflow, so it can sit next to a microphone." />
          <BentoTile area="c" kind="media" title="Hours above 1000 ppm" body="Wednesday had three back to back meetings with the door closed." media={<WeekStrip />} />
          <BentoTile
            area="d"
            kind="list"
            title="Today"
            items={[
              { label: "Time above 1000 ppm", value: "1.4", unit: "h" },
              { label: "Windows opened", value: "2" },
              { label: "Lowest reading", value: "498", unit: "ppm" },
            ]}
          />
        </BentoGrid>

        <FeatureGrid
          variant="rows"
          title="Built to stay on the desk."
          lead="Four decisions that keep Hawa useful after the first week, each with the number behind it."
          items={[
            { title: "Quiet by design", body: "No fan and no chime. Advice appears on the display and nowhere else unless you ask for it.", meta: "0 dB" },
            { title: "Private by default", body: "Readings stay on the device and your home hub. There is no account and no cloud to sign in to.", meta: "0 accounts" },
            { title: "Repairable", body: "The battery and the sensor module come out with one screw, and both are sold as spare parts.", meta: "1 screw" },
            { title: "Made to last", body: "E-paper draws power only when the reading changes, so one charge covers a year and a half.", meta: "18 months" },
          ]}
        />

        <Quote
          tone="layer"
          variant="results"
          quote="We stopped blaming the 3 pm meeting on the agenda. It was the air, and now there is a window rule."
          name="Rina Kartika"
          role="Office manager, a 40 person design studio (sample quote)"
          metrics={[
            { value: "38", unit: "%", caption: "Less time above 1000 ppm in the first month" },
            { value: "4", unit: "rooms", caption: "With a window rule on the door" },
          ]}
        />

        <SpecTable
          id="specs"
          variant="grouped"
          title="Specifications"
          lead="Measured values, the way a datasheet states them."
          groups={[
            {
              name: "Sensing",
              note: "Four sensors, read once a minute.",
              rows: [
                { label: "CO2", value: "400 to 5000", unit: "ppm", note: "NDIR, ±30 ppm from 400 to 2000" },
                { label: "Fine dust", value: "0 to 500", unit: "µg/m³", note: "PM2.5, laser scattering" },
                { label: "Temperature", value: "-10 to 50", unit: "°C", note: "±0.3 °C" },
                { label: "Humidity", value: "0 to 100", unit: "% RH", note: "±3% RH" },
              ],
            },
            {
              name: "Display and power",
              note: "E-paper, so the screen costs nothing at rest.",
              rows: [
                { label: "Display", value: "2.9", unit: "in e-paper", note: "296 × 128 pixels" },
                { label: "Battery", value: "2000", unit: "mAh", note: "About 18 months at one reading a minute" },
                { label: "Charging", value: "5", unit: "V", note: "USB-C" },
              ],
            },
            {
              name: "Size and connection",
              note: "Small enough for a shelf, no hub required.",
              rows: [
                { label: "Size", value: "72 × 96 × 28", unit: "mm" },
                { label: "Weight", value: "180", unit: "g" },
                { label: "Wireless", value: "Matter over Thread, Bluetooth LE 5.3" },
              ],
            },
          ]}
        />

        <PricingTable
          id="pricing"
          tone="layer"
          title="One price, no subscription."
          lead="Every plan includes the day view, advice, and two years of warranty."
          plans={[
            {
              name: "Hawa One",
              price: "1.490.000",
              unit: "IDR",
              summary: "One monitor for one desk or room.",
              features: ["CO2, fine dust, climate", "Day and week view", "Two year warranty"],
              action: <a className="btn" href="#buy">Buy Hawa One</a>,
              recommended: true,
            },
            {
              name: "Room kit",
              price: "3.990.000",
              unit: "IDR",
              summary: "Three monitors for a home or a small office.",
              features: ["Everything in Hawa One", "Shared room view", "CSV export"],
              action: <a className="btn btn-secondary" href="#buy">Buy the room kit</a>,
            },
            {
              name: "Office",
              price: "12.900.000",
              unit: "IDR",
              summary: "Ten monitors, set up by our team.",
              features: ["Everything in Room kit", "On-site setup in Jakarta", "Priority repair"],
              action: <a className="btn btn-secondary" href="#contact">Talk to us</a>,
            },
          ]}
          compare={{
            caption: "Compare plans",
            rows: [
              { label: "Monitors", values: ["1", "3", "10"] },
              { label: "Shared room view", values: [false, true, true] },
              { label: "CSV export", values: [false, true, true] },
              { label: "On-site setup", values: [false, false, true] },
            ],
          }}
        />

        <FAQ
          variant="open"
          title="Questions"
          lead="Plain answers about setup, privacy, and batteries."
          items={[
            { q: "Do I need an account or an app?", a: "No. Hawa works on its own. A Matter hub adds history on your phone, still without an account." },
            { q: "How often should I charge it?", a: "About every 18 months at one reading a minute. Faster readings shorten that to about 6 months." },
            { q: "What happens above 1000 ppm?", a: "The display switches to advice, such as opening a window, and switches back once the room is under 800 ppm." },
            { q: "Can I replace the sensor?", a: "Yes. The sensor module comes out with one screw and ships as a spare part." },
          ]}
        />

        <CTABand
          variant="form"
          title="Put one on your desk this week."
          lead="Leave your email and we send the order link with the week's delivery slots from Jakarta."
          form={
            <form className="kit-form" action="#" onSubmit={(e) => e.preventDefault()}>
              <div className="field">
                <label htmlFor="cta-email">Email</label>
                <input id="cta-email" type="email" name="email" autoComplete="email" placeholder="you@example.com" required />
              </div>
              <div className="kit-actions">
                <button type="submit">Send the order link</button>
              </div>
            </form>
          }
          proof={
            <SpecRail
              label="Order details"
              rows={[
                { label: "Price", value: "1.490.000", unit: "IDR", signal: true },
                { label: "Shipping", value: "2 working days from Jakarta" },
              ]}
            />
          }
        />

        <Footer
          variant="inline"
          brand="Hawa"
          links={[
            { label: "Specs", href: "#specs" },
            { label: "Pricing", href: "#pricing" },
            { label: "Support", href: "#support" },
            { label: "Privacy", href: "#privacy" },
          ]}
          legal="Hawa 2026. Kit preview with sample content."
        />
      </AppShell>
    </Page>
  );
}
