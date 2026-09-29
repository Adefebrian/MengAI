// What you watch in the app (kit.bento.lead-left, JEV 0.98; tier 2 through
// mu.R10 typing, choreography reveal): the code editor typing a real change
// as the lead tile, the live timeline, Kopi's decision log and the minutes
// of the last sync. The editor and the timeline share one typing clock.
import { useRef } from "react";
import { BentoGrid, BentoTile } from "@mengai/ui";
import { WEB_APP_URL } from "../links";
import { DecisionsView, EditorView, MinutesView, TimelineView, useTyping } from "../views/workbench";

export function WorkbenchSection() {
  const editor = useRef<HTMLDivElement>(null);
  const typed = useTyping(editor);
  return (
    <BentoGrid
      id="workbench"
      tone="base"
      preset="lead-left"
      title="Watch every line get written"
      lead={
        <>
          The app shows the office and the work behind it: the file a cat is typing, every event in order, each call Kopi made and the minutes of every meeting.{" "}
          <a href={WEB_APP_URL}>Open the app</a> to watch a sample run.
        </>
      }
    >
      <BentoTile
        area="a"
        kind="media"
        media={
          <div ref={editor} className="lp-tile-view">
            <EditorView typed={typed} />
          </div>
        }
        title="The code, as it is written"
        body="Mochi types the change in your own project, and you read every line as it lands."
      />
      <BentoTile
        area="b"
        kind="media"
        media={
          <div className="lp-tile-view">
            <TimelineView typed={typed} />
          </div>
        }
        title="Every event, in order"
        body="Edits, commands and handoffs, with the time."
      />
      <BentoTile
        area="c"
        kind="media"
        media={
          <div className="lp-tile-view">
            <DecisionsView />
          </div>
        }
        title="What Kopi decided"
        body="Each request, and who answered it."
      />
      <BentoTile
        area="d"
        kind="media"
        media={
          <div className="lp-tile-view">
            <MinutesView />
          </div>
        }
        title="Minutes of every meeting"
        body="Who sat at the table and what they agreed."
      />
    </BentoGrid>
  );
}
