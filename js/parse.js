/**
 * Instagram "Download your information" message parser.
 *
 * Official export layout (JSON, not HTML):
 *   your_instagram_activity/messages/inbox/<thread>/message_1.json
 *   ...message_2.json for long threads
 *
 * Each file is one object: { participants, title, messages[] }.
 * Messages are typically newest-first. Media shares carry a `share`
 * object; hearts and other emoji live in `reactions`.
 */

export const LOVE = new Set(["❤", "❤️", "♥", "♥️", "💕", "💖", "💗", "💓", "💞", "💘", "💝", "🥰", "😍"]);

export function decodeName(value) {
  if (value == null) return "";
  const text = String(value);
  // Instagram encodes non-ASCII as UTF-8 bytes misread as Latin-1.
  if (!/[\u00C0-\u00FF]/.test(text)) return text;
  try {
    const bytes = Uint8Array.from(text, (ch) => ch.charCodeAt(0) & 0xff);
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (decoded.includes("\uFFFD")) return text;
    return decoded;
  } catch {
    return text;
  }
}

function reactionEmoji(entry) {
  return entry?.reaction ?? entry?.emoji ?? "";
}

function reactionActor(entry) {
  return decodeName(entry?.actor ?? entry?.actor_name ?? entry?.name ?? "");
}

export function isVideoShare(message) {
  if (message.videos?.length) return true;
  const share = message.share;
  if (!share) return false;
  const link = String(share.link || "");
  if (/instagram\.com\/(reel|reels|tv)\//i.test(link)) return true;
  if (/instagram\.com\/p\//i.test(link) && /video|reel/i.test(share.share_text || "")) return true;
  const original = String(share.original_content_owner || "");
  if (original && link.includes("instagram.com") && !message.photos?.length) {
    // Shared posts without a photo attachment are usually reels in group chats.
    if (/\/reel\/|\/reels\/|\/tv\//i.test(link)) return true;
  }
  return /\/(reel|reels|tv)\//i.test(link);
}

export function cleanLink(link) {
  if (!link) return "";
  try {
    const url = new URL(link);
    url.search = "";
    url.hash = "";
    return url.toString();
  } catch {
    return String(link).split("?")[0];
  }
}

export function embedUrl(link) {
  const match = String(link || "").match(/instagram\.com\/(?:reel|reels|tv|p)\/([^/?#]+)/i);
  if (!match) return "";
  return `https://www.instagram.com/reel/${match[1]}/embed/`;
}

export function videoKey(message) {
  const link = message.share?.link || message.videos?.[0]?.uri || "";
  if (!link) return null;
  const reel = link.match(/instagram\.com\/(?:reel|reels|tv)\/([^/?#]+)/i);
  if (reel) return `ig:${reel[1]}`;
  const post = link.match(/instagram\.com\/p\/([^/?#]+)/i);
  if (post) return `igp:${post[1]}`;
  return link.split("?")[0];
}

export function videoLabel(message) {
  const share = message.share || {};
  const owner = decodeName(share.original_content_owner || "");
  const text = decodeName(share.share_text || "").replace(/\s+/g, " ").trim();
  const clipped = text.length > 90 ? `${text.slice(0, 87)}…` : text;
  if (owner && clipped) return { owner, caption: clipped };
  if (owner) return { owner, caption: "Shared reel" };
  if (clipped) return { owner: "Unknown creator", caption: clipped };
  if (message.videos?.length) return { owner: "In-chat video", caption: "Uploaded straight into the chat" };
  return { owner: "Shared video", caption: "No caption in the export" };
}

function topEntry(map) {
  let best = null;
  for (const [key, value] of map) {
    if (!best || value > best.value) best = { key, value };
  }
  return best;
}

function formatRange(timestamps) {
  if (!timestamps.length) return null;
  const min = Math.min(...timestamps);
  const max = Math.max(...timestamps);
  const fmt = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" });
  return { start: min, end: max, label: `${fmt.format(min)} – ${fmt.format(max)}` };
}

/**
 * @param {object[]} files parsed JSON objects from message_*.json
 * @param {{ excludeSelfHearts?: boolean }} [options]
 */
export function analyze(files, options = {}) {
  const excludeSelfHearts = options.excludeSelfHearts !== false;
  const messages = [];
  const titles = new Set();
  const participantSet = new Set();

  for (const file of files) {
    if (!file || typeof file !== "object") continue;
    if (file.title) titles.add(decodeName(file.title));
    for (const person of file.participants || []) {
      const name = decodeName(person.name);
      if (name) participantSet.add(name);
    }
    for (const message of file.messages || []) {
      if (message && typeof message === "object") messages.push(message);
    }
  }

  const people = new Map();
  const ensure = (name) => {
    const clean = decodeName(name);
    if (!clean) return null;
    if (!people.has(clean)) {
      people.set(clean, {
        name: clean,
        shares: 0,
        heartsReceived: 0,
        heartsGiven: 0,
        reactionsReceived: 0,
        reactionsGiven: 0,
        messages: 0,
        videosLoved: 0,
        heartGivers: new Map(),
        givenTo: new Map(),
      });
    }
    return people.get(clean);
  };

  for (const name of participantSet) ensure(name);

  const videos = new Map();
  const heartOnText = [];
  let reactionTotal = 0;
  let heartTotal = 0;

  for (const message of messages) {
    const sender = decodeName(message.sender_name || "");
    const person = sender ? ensure(sender) : null;
    if (person && (message.content || message.share || message.photos || message.videos || message.audio_files)) {
      person.messages += 1;
    }

    const reactions = Array.isArray(message.reactions) ? message.reactions : [];
    const hearts = [];
    const reactors = new Set();

    for (const entry of reactions) {
      const emoji = reactionEmoji(entry);
      const actor = reactionActor(entry);
      if (!emoji || !actor) continue;
      if (excludeSelfHearts && actor === sender) continue;
      reactors.add(actor);
      reactionTotal += 1;
      const giver = ensure(actor);
      if (giver) giver.reactionsGiven += 1;
      if (person) person.reactionsReceived += 1;
      if (LOVE.has(emoji)) {
        hearts.push({ actor, emoji });
        heartTotal += 1;
        if (giver) {
          giver.heartsGiven += 1;
          giver.givenTo.set(sender, (giver.givenTo.get(sender) || 0) + 1);
        }
        if (person) {
          person.heartsReceived += 1;
          person.heartGivers.set(actor, (person.heartGivers.get(actor) || 0) + 1);
        }
      }
    }

    if (!isVideoShare(message)) {
      if (hearts.length && message.content) {
        heartOnText.push({
          sender,
          content: decodeName(message.content),
          hearts: hearts.length,
          timestamp: message.timestamp_ms,
        });
      }
      continue;
    }

    const key = videoKey(message) || `local:${message.timestamp_ms}:${sender}`;
    if (!videos.has(key)) {
      const label = videoLabel(message);
      videos.set(key, {
        key,
        link: cleanLink(message.share?.link || ""),
        owner: label.owner,
        caption: label.caption,
        shares: [],
        heartActors: new Set(),
        reactionActors: new Set(),
        hearts: 0,
        reactions: 0,
        firstAt: message.timestamp_ms || 0,
      });
    }
    const video = videos.get(key);
    video.shares.push({
      sender,
      timestamp: message.timestamp_ms || 0,
      hearts: hearts.map((h) => h.actor),
      reactors: [...reactors],
    });
    if ((message.timestamp_ms || Infinity) < (video.firstAt || Infinity)) {
      video.firstAt = message.timestamp_ms;
    }
    for (const heart of hearts) {
      if (heart.actor !== sender) video.heartActors.add(heart.actor);
    }
    for (const actor of reactors) video.reactionActors.add(actor);
    video.hearts = video.heartActors.size;
    video.reactions = video.reactionActors.size;
    if (hearts.length && person) person.videosLoved += 1;
  }

  const roster = [...people.values()].filter((p) => p.messages || p.heartsReceived || p.heartsGiven || p.shares);
  const timestamps = messages.map((m) => m.timestamp_ms).filter((n) => typeof n === "number");
  const videoList = [...videos.values()].map((video) => {
    const sharers = [...new Set(video.shares.map((s) => s.sender).filter(Boolean))];
    const first = [...video.shares].sort((a, b) => a.timestamp - b.timestamp)[0];
    return {
      ...video,
      heartActors: [...video.heartActors],
      reactionActors: [...video.reactionActors],
      sharers,
      discoveredBy: first?.sender || sharers[0] || "Someone",
      shareCount: video.shares.length,
    };
  });

  for (const video of videoList) {
    for (const name of video.sharers) {
      const person = people.get(name);
      if (person) person.shares += 1;
    }
  }

  return {
    title: [...titles][0] || "Group chat",
    range: formatRange(timestamps),
    messageCount: messages.length,
    people: roster.sort((a, b) => b.heartsReceived - a.heartsReceived || a.name.localeCompare(b.name)),
    videos: videoList.sort((a, b) => b.hearts - a.hearts || b.reactions - a.reactions),
    heartOnText: heartOnText.sort((a, b) => b.hearts - a.hearts).slice(0, 5),
    reactionTotal,
    heartTotal,
    participantCount: participantSet.size || roster.length,
  };
}

export function buildAwards(report) {
  const { people, videos, participantCount } = report;
  const awards = [];
  const others = Math.max(participantCount - 1, 1);

  const unanimous = videos
    .filter((v) => v.hearts >= others && v.hearts > 0)
    .sort((a, b) => b.hearts - a.hearts || a.firstAt - b.firstAt);

  if (unanimous.length) {
    const lead = unanimous[0];
    awards.push({
      id: "universal",
      kicker: "The room agrees",
      title: unanimous.length === 1 ? "Universally liked" : `${unanimous.length} universally liked`,
      headline: lead.owner,
      detail: `Every other person in the chat hearted ${lead.sharers.length > 1 ? "this one" : `${lead.discoveredBy}'s send`}. ${lead.caption}`,
      stat: `${lead.hearts}/${others}`,
      statLabel: "hearts from the group",
      tone: "gold",
      items: unanimous.slice(0, 4).map((v) => ({
        key: v.key,
        title: v.owner,
        meta: v.caption,
        value: `${v.hearts} hearts`,
      })),
      videoKey: lead.key,
    });
  } else {
    const closest = [...videos].sort((a, b) => b.hearts / others - a.hearts / others)[0];
    if (closest && closest.hearts > 0) {
      awards.push({
        id: "universal",
        kicker: "Almost unanimous",
        title: "Closest to universal",
        headline: closest.owner,
        detail: `${closest.hearts} of ${others} people hearted it. One holdout is keeping this off the plaque.`,
        stat: `${closest.hearts}/${others}`,
        statLabel: "hearts from the group",
        tone: "gold",
        items: [],
        videoKey: closest.key,
      });
    }
  }

  const popular = [...videos].sort((a, b) => b.hearts - a.hearts || b.reactions - a.reactions)[0];
  if (popular) {
    awards.push({
      id: "popular",
      kicker: "Most loved send",
      title: "Video of the export",
      headline: popular.owner,
      detail: popular.sharers.length > 1
        ? `${popular.discoveredBy} put it in the chat, then ${popular.sharers.length - 1} ${popular.sharers.length - 1 === 1 ? "person sent" : "people sent"} it again. ${popular.caption}`
        : `${popular.discoveredBy} put it in the chat. ${popular.caption}`,
      stat: String(popular.hearts),
      statLabel: popular.hearts === 1 ? "unique heart" : "unique hearts",
      tone: "heat",
      people: popular.heartActors,
      videoKey: popular.key,
    });
  }

  const loved = [...people].sort((a, b) => b.heartsReceived - a.heartsReceived)[0];
  if (loved && loved.heartsReceived > 0) {
    const biggestFan = topEntry(loved.heartGivers);
    awards.push({
      id: "beloved",
      kicker: "Crowd favorite",
      title: "Most liked by the group",
      headline: loved.name,
      detail: biggestFan
        ? `${biggestFan.key} is responsible for ${biggestFan.value} of those hearts.`
        : "The chat keeps tapping the heart on their sends.",
      stat: String(loved.heartsReceived),
      statLabel: "hearts received",
      tone: "rose",
    });
  }

  const curator = [...people].sort((a, b) => {
    const rate = (p) => (p.shares ? p.heartsReceived / p.shares : 0);
    return rate(b) - rate(a) || b.heartsReceived - a.heartsReceived;
  })[0];
  if (curator && curator.shares >= 2 && curator.heartsReceived > 0) {
    const rate = curator.heartsReceived / curator.shares;
    if (rate >= 1) awards.push({
      id: "curator",
      kicker: "Taste you can trust",
      title: "Best hit rate",
      headline: curator.name,
      detail: `${curator.shares} videos in, ${curator.heartsReceived} hearts back. That is ${rate.toFixed(1)} hearts per send.`,
      stat: rate.toFixed(1),
      statLabel: "hearts per video",
      tone: "ink",
    });
  }

  const generous = [...people].sort((a, b) => b.heartsGiven - a.heartsGiven)[0];
  if (generous && generous.heartsGiven > 0) {
    const favorite = topEntry(generous.givenTo);
    awards.push({
      id: "generous",
      kicker: "Finger on the heart",
      title: "Most generous reactor",
      headline: generous.name,
      detail: favorite
        ? `${favorite.value} of those went to ${favorite.key}.`
        : "Hearts leave their phone faster than anyone else's.",
      stat: String(generous.heartsGiven),
      statLabel: "hearts given",
      tone: "ink",
    });
  }

  const reposts = videos.filter((v) => v.sharers.length > 1).sort((a, b) => b.sharers.length - a.sharers.length);
  if (reposts.length) {
    const lead = reposts[0];
    awards.push({
      id: "echo",
      kicker: "Sent it twice",
      title: "Most re-shared",
      headline: lead.owner,
      detail: `${lead.sharers.join(", ")} all dropped the same video into the chat.`,
      stat: String(lead.sharers.length),
      statLabel: "people sent it",
      tone: "heat",
      videoKey: lead.key,
    });
  }

  const dry = [...people].filter((p) => p.shares >= 2).sort((a, b) => a.heartsReceived / a.shares - b.heartsReceived / b.shares)[0];
  if (dry && dry.heartsReceived / dry.shares < 0.6 && people.length > 2) {
    awards.push({
      id: "ahead",
      kicker: "Respectfully",
      title: "Ahead of the group",
      headline: dry.name,
      detail: `${dry.shares} videos shared, ${dry.heartsReceived} hearts earned. The timeline will catch up. Maybe.`,
      stat: String(dry.heartsReceived),
      statLabel: dry.shares === 1 ? "heart on their send" : `hearts across ${dry.shares} sends`,
      tone: "ink",
    });
  }

  const fanPairs = [];
  for (const person of people) {
    const favorite = topEntry(person.givenTo);
    if (favorite && favorite.value >= 3) {
      fanPairs.push({ from: person.name, to: favorite.key, count: favorite.value });
    }
  }
  fanPairs.sort((a, b) => b.count - a.count);
  if (fanPairs.length) {
    const pair = fanPairs[0];
    awards.push({
      id: "fan",
      kicker: "Soft launch",
      title: "Biggest fan",
      headline: pair.from,
      detail: `Hearted ${pair.to} ${pair.count} times. At some point it stops being a coincidence.`,
      stat: String(pair.count),
      statLabel: `hearts for ${pair.to}`,
      tone: "rose",
    });
  }

  if (report.heartOnText?.[0] && report.heartOnText[0].hearts >= 2) {
    const line = report.heartOnText[0];
    awards.push({
      id: "line",
      kicker: "Not even a video",
      title: "Most hearted sentence",
      headline: line.sender,
      detail: `“${line.content}”`,
      stat: String(line.hearts),
      statLabel: "hearts on a text",
      tone: "gold",
    });
  }

  return { awards, unanimous, popular };
}

export function personInitials(name) {
  const parts = name.split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export function formatWhen(ms) {
  if (!ms) return "";
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric" }).format(ms);
}
