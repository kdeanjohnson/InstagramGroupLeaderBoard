/**
 * Instagram HTML export reader.
 * Settings → Export your information → HTML writes one message_1.html
 * per thread, with a sender heading, a body, a reaction list, and a time.
 */

const SENT_ATTACHMENT = / sent an attachment\.?$/i;
const YOU_SENT_ATTACHMENT = /^You sent an attachment\.?$/i;

function textOf(node) {
  return (node?.textContent || "").replace(/\s+/g, " ").trim();
}

function parseWhen(label) {
  if (!label) return 0;
  const ms = Date.parse(label);
  return Number.isNaN(ms) ? 0 : ms;
}

function reactionEntries(list) {
  if (!list) return [];
  return [...list.querySelectorAll("li")].map((li) => {
    const raw = textOf(li);
    const emoji = raw.match(/^(\p{Extended_Pictographic}\uFE0F?)/u)?.[1] || raw.slice(0, 2);
    const actor = raw.slice(emoji.length).trim();
    return actor ? { reaction: emoji, actor } : null;
  }).filter(Boolean);
}

function shareFrom(block) {
  const anchor = [...block.querySelectorAll("a[href]")].find((node) => /instagram\.com\/(reel|reels|p|tv)\//i.test(node.getAttribute("href") || ""));
  if (!anchor) return null;
  const link = anchor.getAttribute("href");
  const card = anchor.parentElement?.parentElement;
  const lines = card
    ? [...card.children].map(textOf).filter((line) => line && !line.startsWith("http"))
    : [];
  const owner = lines.find((line) => !line.includes(" ") && line !== "You") || "";
  const caption = lines.find((line) => line !== owner) || "";
  return {
    link,
    share_text: caption,
    original_content_owner: owner,
  };
}

export function parseHtmlThread(html, fallbackTitle = "") {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const title = textOf(doc.querySelector("header h1")) || fallbackTitle || "Chat";
  const participantLine = [...doc.querySelectorAll("h2")].map(textOf).find((line) => line.startsWith("Participants:"));
  const participants = participantLine
    ? participantLine.replace(/^Participants:\s*/, "").split(/,| and /).map((name) => name.trim()).filter(Boolean)
    : [];

  const messages = [];
  for (const block of doc.querySelectorAll("main .uiBoxWhite")) {
    const sender = textOf(block.querySelector("h2"));
    if (!sender || sender.startsWith("Participants:") || sender.startsWith("Group Invite")) continue;
    const body = block.querySelector("._a6-p");
    const content = textOf(body?.querySelector(":scope > div > div:nth-child(2)"));
    const share = body ? shareFrom(body) : null;
    const reactions = reactionEntries(block.querySelector("ul._a6-q"));
    const timestamp_ms = parseWhen(textOf(block.querySelector("._a6-o")));
    if (/reacted .+ to your message/i.test(content) && !share) continue;
    messages.push({
      sender_name: sender,
      timestamp_ms,
      content: YOU_SENT_ATTACHMENT.test(content) || SENT_ATTACHMENT.test(content) ? "" : content,
      share: share || undefined,
      reactions,
    });
  }

  const names = new Set(participants);
  for (const message of messages) names.add(message.sender_name);
  return {
    title,
    participants: [...names].filter(Boolean).map((name) => ({ name })),
    messages,
  };
}

export function threadFromPath(path) {
  const match = path.match(/inbox\/([^/]+)\/message_\d+\.html?$/i);
  if (!match) return "";
  return match[1].replace(/_\d+$/, "").replace(/_/g, " ");
}
