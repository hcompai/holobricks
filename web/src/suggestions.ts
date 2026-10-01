/** Ideas to start from: Holo gets the detailed prompt, the user sees the short label. */
export const SUGGESTIONS = [
  {
    label: "A red-and-white lighthouse",
    prompt:
      "A tall red-and-white striped lighthouse on a rocky headland. A lantern room of glass under a black dome, a gallery with a railing, small windows climbing the tower. Beside it a keeper's cottage with a slate roof and a smoking chimney. Jagged grey rocks drop into a dark sea with white surf; a stone stair winds down to a wooden jetty with a moored rowing boat, lobster pots and coiled rope. Tufts of grass and wildflowers in the crevices, gulls on the railing.",
  },
  {
    label: "A tiny cottage with a garden",
    prompt:
      "A tiny thatched cottage in an overgrown garden. Whitewashed walls with dark timber beams, a thick sagging thatch roof with a brick chimney, small leaded windows with flower boxes, a red front door under a rose arch. A crooked flagstone path winds through beds of lavender, hollyhocks and foxgloves to a picket gate in a low dry-stone wall. An apple tree heavy with fruit, a wooden bench, a birdbath, a wheelbarrow and a vegetable patch at the back.",
  },
  {
    label: "A retro rocket",
    prompt:
      "A 1950s retro rocket on its launch pad, ready to go. A tall, slender red-and-white fuselage with a pointed nose cone, round portholes and chrome bands, three swept fins standing on landing legs. Beside it a steel lattice gantry tower with a crew access arm, ladders and floodlights. Fuel pipes and tanks, yellow-and-black warning stripes on the pad, a small concrete control bunker with a radar dish, and a crew van parked nearby.",
  },
  {
    label: "A friendly robot",
    prompt:
      "A friendly retro robot standing in a cluttered tinkerer's workshop. A boxy light grey body, a round head with two big glowing blue eyes and an antenna tipped with a red light, a chest panel of colored buttons and dials, jointed arms with claw hands holding a wrench, and tank treads for feet. Around it a workbench covered with tools, gears and a desk lamp, shelves of spare parts, a potted plant and a small robot dog.",
  },
];

const LABELS = new Map(SUGGESTIONS.map((s) => [s.prompt, s.label]));

/** The short label of a suggestion's prompt, or undefined for anything else. */
export const label = (prompt: string): string | undefined => LABELS.get(prompt);
