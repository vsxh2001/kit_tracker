import { pb } from "../../lib/pocketbase";
import { listKits, getLatestTransaction, parseTags } from "../../services/kits";
import { listRequests } from "../../services/requests";
import { getCurrentOnCallUsers } from "../../services/oncall";
import { formatDate } from "../../lib/utils";
import type { Kit, Transaction } from "../../types";
import {
  handleKit,
  handleComp,
  handleComps,
  handleInKit,
  handleAt,
  handleUpcoming,
  handleDue,
  handleMe,
  handleToday,
  handleHistory,
} from "./slash-commands/handlers";

export type SlashResult =
  | { ok: true; text: string }
  | { ok: false; error: string };

export const COMMANDS: Array<{ name: string; usage: string; help: string }> = [
  { name: "help",    usage: "/help",                help: "Show available slash commands." },
  { name: "kits",    usage: "/kits [@tag]",         help: "List active kits, optional tag filter." },
  { name: "where",   usage: "/where <serial>",      help: "Show current holder and last move for a kit." },
  { name: "req",     usage: "/req",                 help: "Show your open requests." },
  { name: "oncall",  usage: "/oncall",              help: "Show who is on call right now." },
  { name: "kit",     usage: "/kit <serial>",        help: "Full kit report: holder, components, maintenance, last 5 moves." },
  { name: "comp",    usage: "/comp <serial>",       help: "Component report: product, location, last 3 moves." },
  { name: "comps",   usage: "/comps <product>",     help: "List components of a product with current location. (matches by exact name first, then substring; specify exact name if ambiguous)" },
  { name: "inkit",   usage: "/inkit <kit-serial>",  help: "All components currently inside a specific kit." },
  { name: "at",      usage: "/at <entity-name>",    help: "All kits currently at an entity. (matches by exact name first, then substring; specify exact name if ambiguous)" },
  { name: "upcoming",usage: "/upcoming",            help: "Next 30 days of approved/open requests with delivery date." },
  { name: "due",     usage: "/due",                 help: "Maintenance schedules due in next 7 days." },
  { name: "me",      usage: "/me",                  help: "Current user: role, open requests, on-call status." },
  { name: "today",   usage: "/today",               help: "Daily standup: open req count, deliveries today, on-call, overdue maint." },
  { name: "history", usage: "/history <serial>",    help: "All transactions for a kit, formatted as timeline." },
];

const KIT_SERIAL_CMDS = new Set(["where", "kit", "inkit", "history"]);
const ENTITY_NAME_CMDS = new Set(["at"]);
const PRODUCT_NAME_CMDS = new Set(["comps"]);

export function isSlashCommand(input: string): boolean {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return false;
  const name = trimmed.slice(1).split(/\s+/)[0].toLowerCase();
  return COMMANDS.some((c) => c.name === name);
}

export function parseCommand(input: string): { name: string; args: string[] } | null {
  const trimmed = input.trim();
  if (!trimmed.startsWith("/")) return null;
  const parts = trimmed.slice(1).split(/\s+/);
  const name = parts[0]?.toLowerCase() ?? "";
  if (!COMMANDS.some((c) => c.name === name)) return null;
  return { name, args: parts.slice(1) };
}

export function getArgResourceType(
  commandName: string
): "kit-serial" | "entity-name" | "product-name" | null {
  if (KIT_SERIAL_CMDS.has(commandName)) return "kit-serial";
  if (ENTITY_NAME_CMDS.has(commandName)) return "entity-name";
  if (PRODUCT_NAME_CMDS.has(commandName)) return "product-name";
  return null;
}

async function handleHelp(): Promise<SlashResult> {
  const lines = COMMANDS.map((c) => `\`${c.usage}\` — ${c.help}`);
  return { ok: true, text: "**Slash commands:**\n" + lines.join("\n") };
}

async function handleKits(args: string[]): Promise<SlashResult> {
  const tagArg = args.find((a) => a.startsWith("@"))?.slice(1).toLowerCase();
  let kits = await listKits(false);
  if (tagArg) {
    kits = kits.filter((k: Kit) => parseTags(k.tags).includes(tagArg));
  }
  if (kits.length === 0) {
    const suffix = tagArg ? ` with tag \`@${tagArg}\`` : "";
    return { ok: true, text: `No active kits found${suffix}.` };
  }
  const lines = kits.map((k: Kit) => {
    const tags = parseTags(k.tags);
    const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";
    return `- \`${k.serial}\`${tagStr}`;
  });
  const header = tagArg
    ? `**Active kits tagged \`@${tagArg}\`** (${kits.length}):`
    : `**Active kits** (${kits.length}):`;
  return { ok: true, text: header + "\n" + lines.join("\n") };
}

async function handleWhere(args: string[]): Promise<SlashResult> {
  const serial = args[0];
  if (!serial) {
    return { ok: false, error: "Usage: `/where <serial>`" };
  }
  let kit: Kit;
  try {
    kit = await pb.collection("kits").getFirstListItem<Kit>(
      pb.filter("serial = {:serial}", { serial }),
      { requestKey: `slash-where-${serial}` }
    );
  } catch {
    return { ok: false, error: `No kit with serial '${serial}'.` };
  }
  let tx: Transaction | null = null;
  try {
    tx = await getLatestTransaction(kit.id);
  } catch {
    // no transactions is fine
  }
  if (!tx) {
    return { ok: true, text: `Kit \`${kit.serial}\` has no recorded moves.` };
  }
  const holder = tx.expand?.to_entity?.name ?? tx.to_entity;
  const by = tx.expand?.created_by?.name ?? tx.expand?.created_by?.email ?? "unknown";
  const when = formatDate(tx.timestamp);
  return {
    ok: true,
    text: `Kit \`${kit.serial}\` is at **${holder}** (moved ${when} by ${by}).`,
  };
}

async function handleReq(): Promise<SlashResult> {
  const myId = pb.authStore.model?.id;
  if (!myId) {
    return { ok: false, error: "Not authenticated." };
  }
  const requests = await listRequests("open");
  const mine = requests.filter((r) => r.requester === myId);
  if (mine.length === 0) {
    return { ok: true, text: "You have no open requests." };
  }
  const lines = mine.map((r) => {
    const kit = r.expand?.designated_kit?.serial ?? r.designated_kit ?? "—";
    const entity = r.expand?.target_entity?.name ?? r.target_entity ?? "—";
    return `- Request \`${r.id}\` — kit: ${kit}, entity: ${entity}, delivery: ${r.delivery_date}`;
  });
  return { ok: true, text: `**Your open requests** (${mine.length}):\n` + lines.join("\n") };
}

async function handleOncall(): Promise<SlashResult> {
  const users = await getCurrentOnCallUsers();
  if (users.length === 0) {
    return { ok: true, text: "No one is on call right now." };
  }
  const lines = users.map((u) => {
    const name = u.name ?? u.email;
    return `- **${name}** (${u.role})`;
  });
  return { ok: true, text: "**On call now:**\n" + lines.join("\n") };
}

export async function execute(parsed: { name: string; args: string[] }): Promise<SlashResult> {
  switch (parsed.name) {
    case "help":    return handleHelp();
    case "kits":    return handleKits(parsed.args);
    case "where":   return handleWhere(parsed.args);
    case "req":     return handleReq();
    case "oncall":  return handleOncall();
    case "kit":     return handleKit(parsed.args);
    case "comp":    return handleComp(parsed.args);
    case "comps":   return handleComps(parsed.args);
    case "inkit":   return handleInKit(parsed.args);
    case "at":      return handleAt(parsed.args);
    case "upcoming":return handleUpcoming();
    case "due":     return handleDue();
    case "me":      return handleMe();
    case "today":   return handleToday();
    case "history": return handleHistory(parsed.args);
    default:
      return { ok: false, error: `Unknown command. Type \`/help\` to see available commands.` };
  }
}
