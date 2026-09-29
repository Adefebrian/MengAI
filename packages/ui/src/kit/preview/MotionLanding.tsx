// Kit preview, page B: the same system in another direction (D3
// blueprint_hairline by default), with the opt-in motion module on: Lenis
// smooth scroll on the GSAP clock and KitMotion at tier 3 (split-line
// headlines, scrubbed story, rail rows). Sample product and sample content;
// every media slot is a live data view, never a drawn product.
//
// Ledger (composition.variant, in ledgers.ts, validated in kit.test.tsx):
//   masthead.left, split.bleed, stat-row.chart, feature-grid.lead,
//   sticky-story.stage-end, spec-table.rail, quote.pull,
//   feature-grid.detail, bento.lead-left, faq.split, cta-band.band,
//   footer.statement
import { KitMotion, SmoothScroll, useScrollRefresh } from "@kit-preview/motion";
import { AppShell } from "../../AppShell";
import {
  BentoGrid,
  BentoTile,
  CTABand,
  FAQ,
  FeatureGrid,
  Footer,
  Masthead,
  MediaFrame,
  Page,
  Quote,
  SpecRail,
  SpecTable,
  Split,
  StatRow,
  StickyStory,
  type DirectionId,
} from "../index";
import { DayReadout, EventLog, RoomList, SensorGrid, WeekStrip } from "./art";

const destinations = [
  { id: "top", label: "Office", href: "#top" },
  { id: "story", label: "How", href: "#story" },
  { id: "specs", label: "Specs", href: "#specs" },
  { id: "order", label: "Order", href: "#order" },
];

function Refresh() {
  useScrollRefresh();
  return null;
}

export function MotionLanding({ direction }: { direction: DirectionId }) {
  return (
    <Page direction={direction} theme={direction === "D13" ? "dark" : undefined} rhythm="default" motion="staged">
      <AppShell title="Hawa Office" destinations={destinations} current="top" actions={<a className="btn btn-secondary" href="#order">Order</a>}>
        <SmoothScroll>
          <KitMotion tier={3} />
          <Masthead
            id="top"
            variant="left"
            title="Every room, one plain sentence."
            lead="Hawa Office puts a monitor in each room and tells the whole floor when the air turns, before the 3 pm meeting does."
            actions={
              <>
                <a className="btn" href="#order">
                  Order the office kit
                </a>
                <a className="btn btn-secondary" href="#story">
                  See a floor at work
                </a>
              </>
            }
            proof={
              <SpecRail
                layout="strip"
                label="The office kit"
                rows={[
                  { label: "Monitors", value: "10" },
                  { label: "Rooms per hub", value: "32" },
                  { label: "Setup", value: "1", unit: "day" },
                  { label: "Accounts to manage", value: "0" },
                ]}
              />
            }
          />

          <Split
            tone="layer"
            variant="bleed"
            ratio="5/7"
            mediaSide="end"
            title="Ten rooms, one view."
            lead="Each monitor reports to the floor view on the office hub. Nobody opens an app; the rooms that need a window rise to the top."
            media={
              <MediaFrame kind="view" ratio="16/9" tone="surface" caption="The floor view on a Tuesday, 15:10.">
                <RoomList />
              </MediaFrame>
            }
          >
            <SpecRail
              label="Office hub"
              rows={[
                { label: "Update", value: "60", unit: "s" },
                { label: "History", value: "12", unit: "months" },
                { label: "Network", value: "Local only" },
              ]}
            />
          </Split>

          <StatRow
            variant="chart"
            title="What changed in a month."
            lead="A 40 person studio, ten monitors, the first four weeks."
            stats={[
              { value: "38", unit: "%", caption: "Less time above 1000 ppm.", signal: true },
              { value: "4", unit: "rooms", caption: "With a window rule on the door." },
              { value: "0", unit: "tickets", caption: "To facilities about stuffy rooms." },
              { value: "11", unit: "min", caption: "From advice to an open window." },
            ]}
            chart={
              <MediaFrame kind="view" ratio="3/2" tone="surface" caption="Hours above 1000 ppm, the studio's first week.">
                <WeekStrip />
              </MediaFrame>
            }
          />

          <FeatureGrid
            tone="layer"
            variant="lead"
            title="Made for rooms full of people."
            lead="Two things carry the office plan; four more keep it running."
            items={[
              {
                title: "Advice where people are",
                body: "Each room's monitor says what fixes it, and the hub logs when someone did.",
                media: (
                  <MediaFrame kind="view" ratio="16/9" tone="surface">
                    <EventLog />
                  </MediaFrame>
                ),
              },
              {
                title: "Every reading, every minute",
                body: "Four sensors per room report to the hub once a minute, with the state in plain words.",
                media: (
                  <MediaFrame kind="view" ratio="16/9" tone="surface">
                    <SensorGrid />
                  </MediaFrame>
                ),
              },
              { title: "No accounts", body: "Staff never sign in. The hub stays on your network." },
              { title: "CSV export", body: "Every reading, every room, for the monthly report." },
              { title: "Spare parts", body: "Sensors and batteries ship on their own." },
              { title: "Setup included", body: "Our team mounts and pairs every room in a day." },
            ]}
          />

          <StickyStory
            id="story"
            variant="stage-end"
            title="A floor at work."
            lead="One afternoon in the studio, told by its monitors."
            steps={[
              {
                title: "14:00, the room fills",
                body: "Eight people and a closed door. Meeting room 2 climbs past 800 ppm inside twenty minutes.",
                media: (
                  <MediaFrame kind="view" ratio="16/9" tone="surface">
                    <SensorGrid />
                  </MediaFrame>
                ),
              },
              {
                title: "15:00, the monitor speaks",
                body: "At 1240 ppm the display switches to advice, and the hub moves the room to the top of the floor view.",
                media: (
                  <MediaFrame kind="view" ratio="16/9" tone="surface">
                    <EventLog />
                  </MediaFrame>
                ),
              },
              {
                title: "15:40, the room recovers",
                body: "A window opens at 15:05. By 15:40 the room is back under 800 and the display goes quiet.",
                media: (
                  <MediaFrame kind="view" ratio="4/3" tone="surface">
                    <DayReadout />
                  </MediaFrame>
                ),
              },
            ]}
          />

          <SpecTable
            id="specs"
            tone="layer"
            variant="rail"
            title="The office kit, measured."
            lead="What arrives, what it needs, and what it reports."
            prose={
              <>
                <p className="kit-lead">
                  Ten monitors and one hub arrive in a single box. Our team mounts each monitor at head height, away from windows and vents, so it reads the air people breathe.
                </p>
                <MediaFrame kind="view" ratio="16/9" tone="surface" caption="What each monitor reports, once a minute.">
                  <SensorGrid />
                </MediaFrame>
                <p className="kit-lead">
                  The hub keeps a year of readings on the device and exports them as CSV. Nothing leaves your network unless you send the file yourself.
                </p>
              </>
            }
            groups={[
              {
                name: "In the box",
                rows: [
                  { label: "Monitors", value: "10" },
                  { label: "Office hub", value: "1" },
                  { label: "Wall mounts", value: "10" },
                ],
              },
              {
                name: "The hub",
                rows: [
                  { label: "Rooms", value: "32", note: "Up to 32 monitors" },
                  { label: "History", value: "12", unit: "months" },
                  { label: "Power", value: "5", unit: "V", note: "USB-C" },
                ],
              },
            ]}
          />

          <Quote
            variant="pull"
            quote="Facilities used to hear about the air from complaints. Now the rooms tell us first, and the complaints stopped."
            name="Dimas Pratama"
            role="Head of facilities, a design studio in Jakarta (sample quote)"
          />

          <FeatureGrid
            variant="detail"
            title="Three views, one hub."
            lead="Pick a view to see what the office hub shows."
            items={[
              {
                title: "Floor view",
                body: "Every room ranked by how soon it needs air.",
                media: (
                  <MediaFrame kind="view" ratio="4/3" tone="surface">
                    <RoomList />
                  </MediaFrame>
                ),
              },
              {
                title: "Room day",
                body: "One room across the working day, with the moment it turned.",
                media: (
                  <MediaFrame kind="view" ratio="4/3" tone="surface">
                    <DayReadout />
                  </MediaFrame>
                ),
              },
              {
                title: "Week",
                body: "Hours above 1000 ppm per day, for the Friday review.",
                media: (
                  <MediaFrame kind="view" ratio="4/3" tone="surface">
                    <WeekStrip />
                  </MediaFrame>
                ),
              },
            ]}
          />

          <BentoGrid tone="layer" preset="lead-left" title="The studio, this week." lead="Ten monitors, one floor, five facts.">
            <BentoTile area="a" kind="media" title="Hours above 1000 ppm" body="Wednesday had three meetings back to back." media={<WeekStrip />} />
            <BentoTile area="b" kind="text" title="The rule on the door" body="Open the window at the first advice, close it when the display goes quiet." />
            <BentoTile area="c" kind="stat" value="3.1" unit="h" body="Wednesday, the worst day." signal />
            <BentoTile area="d" kind="stat" value="1.4" unit="h" body="Meeting room 2, the busiest room." />
            <BentoTile area="e" kind="stat" value="0.2" unit="h" body="Saturday, the office empty." />
          </BentoGrid>

          <FAQ
            variant="split"
            title="Office questions"
            lead="Setup, networks, and what happens to the data."
            items={[
              { q: "Does the hub need the internet?", a: "No. It runs on your local network and keeps a year of readings on the device." },
              { q: "How long does setup take?", a: "One working day for ten rooms, including mounting and pairing." },
              { q: "Can we add rooms later?", a: "Yes. One hub takes up to 32 monitors; add them one at a time." },
              { q: "Who sees the readings?", a: "Anyone on your network with the hub's address. There are no accounts to manage." },
            ]}
          />

          <CTABand
            id="order"
            variant="band"
            title="Bring the office kit in next week."
            lead="Ten monitors, one hub, and our team on site for a day."
            actions={
              <>
                <a className="btn" href="#order">
                  Order the office kit
                </a>
                <a className="btn btn-secondary" href="#specs">
                  Read the specs
                </a>
              </>
            }
            proof={
              <SpecRail
                layout="strip"
                label="Office kit order"
                rows={[
                  { label: "Price", value: "12.900.000", unit: "IDR", signal: true },
                  { label: "Setup", value: "1", unit: "day" },
                  { label: "Warranty", value: "2", unit: "years" },
                  { label: "Delivery", value: "5", unit: "working days" },
                ]}
              />
            }
          />

          <Footer
            variant="statement"
            brand="Hawa"
            statement="Air you can read, in every room people share."
            links={[
              { label: "Specs", href: "#specs" },
              { label: "Order", href: "#order" },
              { label: "Support", href: "#support" },
              { label: "Privacy", href: "#privacy" },
            ]}
            legal="Hawa 2026. Kit preview with sample content."
          />
          <Refresh />
        </SmoothScroll>
      </AppShell>
    </Page>
  );
}
