import type { CaptureResult } from "posthog-js";

/** Marks an element whose text and labels are a user's own words: prompts, chat, names. Clicks inside still count. */
export const PRIVATE = "ph-private";
/** Marks an element whose visible text can be kept but whose title, alt and aria-label hold a user's words. */
export const PRIVATE_LABELS = "ph-private-labels";

const EMAIL = /[\w.%+-]+@[\w-]+(?:\.[\w-]+)+/g;
const LABELS = /attr__(?:title|alt|aria-label)="(?:[^"\\]|\\.)*"/g;
const TEXT = /(?<![\w-])text="(?:[^"\\]|\\.)*"/g;
const CLASS = /attr__class="((?:[^"\\]|\\.)*)"/;
const LABEL_KEYS = ["attr__title", "attr__alt", "attr__aria-label"];

type Element = Record<string, unknown>;

/** An `$elements_chain`'s elements, the clicked one first, split on the `;` between them and never inside a value. */
function elementsOf(chain: string): string[] {
  const elements: string[] = [];
  let start = 0;
  let quoted = false;
  for (let i = 0; i < chain.length; i++) {
    if (chain[i] === "\\") i++;
    else if (chain[i] === '"') quoted = !quoted;
    else if (chain[i] === ";" && !quoted) {
      elements.push(chain.slice(start, i));
      start = i + 1;
    }
  }
  elements.push(chain.slice(start));
  return elements;
}

const classesOf = (element: string) => element.match(CLASS)?.[1].split(/\s+/) ?? [];

/** How many elements, from the clicked one up, sit inside the outermost element marked with `marker`. */
function depth(classes: string[][], marker: string): number {
  for (let i = classes.length - 1; i >= 0; i--) if (classes[i].includes(marker)) return i + 1;
  return 0;
}

const redact = (value: string) => value.replace(EMAIL, "[email]");

/** The click with no user's words in it: marked areas lose their text and labels, and no email survives anywhere. */
export function scrubbed(event: CaptureResult): CaptureResult {
  const properties = event.properties;
  const chain = properties.$elements_chain;
  const elements: Element[] | undefined = properties.$elements;
  const classes =
    typeof chain === "string"
      ? elementsOf(chain).map(classesOf)
      : (elements?.map((element) => (element.classes as string[] | undefined) ?? []) ?? []);
  const hidden = depth(classes, PRIVATE);
  const unlabelled = Math.max(hidden, depth(classes, PRIVATE_LABELS));

  if (typeof chain === "string") {
    properties.$elements_chain = elementsOf(chain)
      .map((element, i) => {
        let kept = i < unlabelled ? element.replace(LABELS, "") : element;
        if (i < hidden) kept = kept.replace(TEXT, "");
        return redact(kept);
      })
      .join(";");
  }
  elements?.forEach((element, i) => {
    if (i < unlabelled) for (const key of LABEL_KEYS) delete element[key];
    if (i < hidden) delete element.$el_text;
    for (const [key, value] of Object.entries(element)) if (typeof value === "string") element[key] = redact(value);
  });
  if (hidden > 0) delete properties.$el_text;
  else if (typeof properties.$el_text === "string") properties.$el_text = redact(properties.$el_text);
  return event;
}
