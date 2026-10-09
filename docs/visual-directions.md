# Visual directions

## Goal and scope

Give users a fast way to review a model with Holo: sketch a change or paint an area to remove, add an optional comment, and send it through the existing chat. This is visual direction, not direct brick/block editing. Implement the same interaction in HoloBricks and HoloBlocks on a branch from the latest development main.

## User journey

1. On a rendered build that can receive chat messages, choose **Annotate**. Public previews and earlier versions keep the existing copy/version flow.
2. Finish only the browser’s visual reveal, then capture the displayed model and its revision and visible step. Show a frozen image; camera motion and live model updates must not move strokes. If the revision or step changes during capture, refuse that capture and offer retry.
3. **Draw** makes blue freehand marks for additions or changes. **Erase** paints translucent red marks for removal requests. Neither operation changes the underlying model. Short contextual hints explain the active tool.
4. **Undo** removes the last mark; **Clear** removes all marks. Cancel/Escape leaves the chat and model untouched. Done requires at least one mark.
5. **Done** puts the marked image in the existing composer and focuses it. It does not send or start an agent. Users can add a comment, remove the attachment, or send without a comment (the chat uses “Apply my marks.” to distinguish directions from a new reference photo).
6. Send follows the existing session lifecycle: the current session receives it while running or idle; the existing recovery/remix path handles ended sessions. The chat immediately shows the pending user message and image. No new queue or background worker is introduced.

## Data and wiring

Reuse each scene's current-view image export, the viewer, the chat image composer, `onSay`/`onRemix`, and `session.sendMessage`. Keep image and annotation sidecar together as one draft attachment so removal/retry never leaves hidden directions behind, including when two images happen to be identical.

The marked PNG includes a readable blue/red legend. Keep freehand stroke coordinates in the browser; send the image and a small sidecar rather than adding a large stroke dump to the agent context. Limit exported resolution to the existing image budget. A uniquely named JSON sidecar carries the build ID, revision, visible step, image dimensions and tool meanings. Files use the existing uploaded attachment path and are read as user input. Keep normal photographs unchanged. No backend schema, authentication, storage or dependency changes are needed.

## Agent behaviour

Add a short instruction to the existing agent prompt. The agent must interpret the marked image and accompanying comment, preserve unmarked areas, and check the captured revision/step against its current model before acting. Red marks refer to visible targets; they must not imply removing hidden objects behind those targets. If the view cannot be mapped confidently or the sketch is ambiguous, ask a short clarification. A message received during construction joins the next plan update, using the existing mid-run instruction.

## Interaction and failure handling

Support mouse, pen and touch using pointer capture; keep SVG and exported PNG coordinates aligned when the image is letterboxed, resized, zoomed or panned. Trackpad pinch and zoom shortcuts inside the annotation zoom only its frozen image; ordinary scrolling pans it. Small zoom/fit controls offer the same zoom without a trackpad. Closing the editor discards that local view transform, and exported marks remain on the full original image. Reserve space for the phone header and existing chat sheet. Done focuses the current chat, whose existing phone focus behaviour opens the sheet. Camera/timeline controls are unavailable while marking the frozen view.

An unavailable renderer, changed capture, failed export or full attachment slot leaves an explicit error. Failed chat delivery restores the marked image, sidecar and comment. Removing one annotation removes only its own sidecar. Navigating to another project clears the overlay; an asynchronous attachment must refuse a different project ID. Markup lives in the draft and then the existing chat history; it is not a model version and is not a new public-library asset.

## Verification and rollout

- TypeScript and production build in both apps.
- Browser coverage for Draw/Erase and Undo/Clear, same-session mid-run delivery, no model mutation/restart, cancellation and attachment removal, failed-send retry, capacity/duplicate attachments, touch input and capture context after live revision changes, read-only public previews, and local zoom/pan with exported coordinate alignment and shortcut cleanup.
- Inspect desktop and phone screenshots; run existing related chat and editor regressions.
- Keep real-agent interpretation separate from transport correctness. Mocked API browser tests prove the request payload and UI, not that Holo reliably edits arbitrary sketches. Validate a live annotated build before releasing broadly: mark an obvious visible target, request one addition and one removal, inspect the resulting geometry and verify unrelated areas survive.

## Deferred

Do not add a forced “Send now” button: the verified SDK promises delivery on the next agent step, not safe immediate inference interruption. Do not add manual construction tools, 3D region inference, new forms, revision trees or infrastructure to this change. The current Draw/Erase feature does not promise pixel-perfect selection or deletion of occluded geometry.
