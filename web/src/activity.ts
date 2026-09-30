import type { HaiAgents } from "hai-agents";

const file = (path: string) => path.split("/").pop() || "a file";

function host(url: unknown): string {
  try {
    return new URL(String(url)).hostname.replace(/^www\./, "");
  } catch {
    return "a web page";
  }
}

function command(line: string): string {
  if (line.includes("setup.sh")) return "Installing the toolkit";
  if (/\bbricks run\b/.test(line)) return "Building the model";
  if (/\bbricks (parts|colors|check)\b/.test(line)) return "Checking parts";
  if (/\bbricks name\b/.test(line)) return "Naming the build";
  if (/\bbricks assembly\b/.test(line)) return "Checking how it holds together";
  if (/\bcurl\b/.test(line)) return "Downloading photos";
  return "Running a command";
}

/** What the builder does with a tool call, as the chat says it. */
export function doing({ toolName, args = {} }: HaiAgents.ToolRequest): string {
  const path = String(args.path ?? args.file_path ?? args.source ?? "");
  const notes = path.endsWith("notes.md");
  const script = path.endsWith("build.py");
  const showcase = path.includes("showcase/");
  switch (toolName) {
    case "shell":
      return command(String(args.command ?? ""));
    case "poll_execution":
      return "Waiting for a command";
    case "read_file":
      if (notes) return "Reading its notes";
      if (script) return "Reading the build script";
      return showcase ? "Studying a showcase" : `Reading ${file(path)}`;
    case "write_file":
    case "search_replace":
      if (notes) return "Updating its notes";
      if (script) return toolName === "write_file" ? "Writing the build script" : "Editing the build script";
      return `Writing ${file(path)}`;
    case "view_image":
      return showcase ? "Studying a showcase" : "Studying a photo";
    case "share_files":
      return "Sharing a new revision";
    case "look":
      return "Looking at the model";
    case "web_search":
      return args.query ? `Searching “${args.query}”` : "Searching the web";
    case "web_fetch":
      return `Reading ${host(args.url)}`;
    default:
      return toolName.replaceAll("_", " ");
  }
}
