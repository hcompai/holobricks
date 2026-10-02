import { label } from "./suggestions";

export type SubjectKind = "tower" | "castle" | "house" | "tree" | "bridge" | "ship" | "animal" | "rocket" | "robot";

const OUTLINES: Record<SubjectKind, string> = {
  rocket:
    "M77 108V50Q77 26 95 14Q113 26 113 50V108ZM77 73 53 95V116H77M113 73 137 95V116H113M83 116 95 135 107 116M87 48H103V64H87Z",
  robot:
    "M68 45V22H122V45ZM57 52H133V95H57ZM68 103V120H83V103M107 103V120H122V103M50 57H34V90M140 57H156V90M77 31H83M107 31H113M85 65H105V80H85Z",

  tower: "M65 116V28H125V116ZM65 28V18H80V28H110V18H125V28M86 116V91H105V116",
  castle:
    "M30 116V39H65V68H125V39H160V116ZM30 39V26H42V39H53V26H65V39M125 39V26H137V39H149V26H160V39M82 116V91Q95 77 108 91V116",
  house: "M40 116V64L95 23 150 64V116ZM30 70 95 21 160 70M83 116V86H107V116M52 78H70V96H52Z",
  tree: "M82 116V80H108V116M95 22 129 57H115L143 85H47L75 57H61ZM65 116H125",
  bridge: "M25 72H165V89H25ZM38 89V117M152 89V117M55 117Q95 60 135 117M25 58V72M165 58V72M25 58H165",
  ship: "M29 89H161L140 116H53ZM95 89V24L143 75H95M85 35 48 78H85ZM80 116H110",
  animal: "M37 90V57H115V38H151V78H123V94H110V116H96V94H61V116H47V94ZM151 48H163V67H151M37 60 24 43M130 52H136",
};

export function buildSubject(name: string, request: string) {
  const text = `${request} ${name}`.toLowerCase();
  const kind: SubjectKind = /robot/.test(text)
    ? "robot"
    : /rocket|spaceship/.test(text)
      ? "rocket"
      : /castle|cathedral|abbey|fortress|palace/.test(text)
        ? "castle"
        : /tree|forest|grove/.test(text)
          ? "tree"
          : /bridge|viaduct|causeway/.test(text)
            ? "bridge"
            : /ship|boat|sail|space|rocket/.test(text)
              ? "ship"
              : /cat\b|dog\b|dragon|animal|horse|bird|fox/.test(text)
                ? "animal"
                : /tower|lighthouse|pagoda/.test(text)
                  ? "tower"
                  : "house";
  const named = name && !["New build", "Untitled build"].includes(name);
  const title = (named ? name : (label(request) ?? request)).replace(/\s+/g, " ").trim();
  const color = /wood|oak|cabin|timber/.test(text)
    ? "#aa7b50"
    : /tree|forest|garden|leaves/.test(text)
      ? "#6b9762"
      : /stone|castle|cathedral|lighthouse/.test(text)
        ? "#8888a6"
        : undefined;
  return {
    kind,
    title: title.length > 64 ? `${title.slice(0, 61).trimEnd()}…` : title || "Your build",
    outline: OUTLINES[kind],
    color,
  };
}

export type BuildSubject = ReturnType<typeof buildSubject>;
