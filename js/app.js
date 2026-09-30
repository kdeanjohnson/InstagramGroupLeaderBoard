import { analyze, buildAwards, personInitials, formatWhen, decodeName, embedUrl } from "./parse.js";
import { parseHtmlThread, threadFromPath } from "./html.js";

const gate = document.querySelector("#gate");
const board = document.querySelector("#board");
const resetBtn = document.querySelector("#reset");
const fileInput = document.querySelector("#file");
const sampleBtn = document.querySelector("#sample");
const errorEl = document.querySelector("#error");
const drop = gate;
const drawerRoot = document.querySelector("#drawer-root");

let report = null;
let library = [];

fileInput.addEventListener("change", () => {
  if (fileInput.files?.length) ingest(fileInput.files);
});

sampleBtn.addEventListener("click", async () => {
  clearError();
  try {
    const response = await fetch("sample/message_1.json");
    if (!response.ok) throw new Error("Sample chat could not be loaded.");
    const data = await response.json();
    show(analyze([data]));
  } catch (error) {
    fail(error.message || "Could not load the sample.");
  }
});

resetBtn.addEventListener("click", () => {
  report = null;
  board.replaceChildren();
  board.classList.add("hidden");
  gate.classList.remove("hidden");
  resetBtn.classList.add("hidden");
  closeDrawer();
  fileInput.value = "";
});

["dragenter", "dragover"].forEach((type) => {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.add("hot");
  });
});

["dragleave", "drop"].forEach((type) => {
  drop.addEventListener(type, (event) => {
    event.preventDefault();
    drop.classList.remove("hot");
  });
});

drop.addEventListener("drop", (event) => {
  if (event.dataTransfer?.files?.length) ingest(event.dataTransfer.files);
});

function clearError() {
  errorEl.hidden = true;
  errorEl.textContent = "";
}

function fail(message) {
  errorEl.hidden = false;
  errorEl.textContent = message;
}

async function ingest(fileList) {
  clearError();
  try {
    const parsed = await readExports(fileList);
    if (!parsed.length) {
      fail("No messages in that drop. Use Instagram’s download zip, or a message_1.json / message_1.html from the inbox folder.");
      return;
    }
    library = parsed.map((doc, index) => ({
      id: `${doc.title}-${index}`,
      doc,
    })).sort((a, b) => {
      const group = (doc) => (doc.participants?.length || 0) >= 3;
      return Number(group(b.doc)) - Number(group(a.doc))
        || (b.doc.messages?.length || 0) - (a.doc.messages?.length || 0);
    });
    if (library.length === 1) {
      show(analyze([library[0].doc]));
      return;
    }
    showPicker();
  } catch (error) {
    fail(error.message || "Could not read that export.");
  }
}

function showPicker() {
  gate.classList.add("hidden");
  resetBtn.classList.remove("hidden");
  board.classList.remove("hidden");
  board.replaceChildren();
  const mast = el("header", "mast");
  const intro = el("div");
  intro.append(
    el("p", "kicker", "Pick a chat"),
    el("h1", null, "Which group gets the plaques?"),
    el("p", "lede", "This download has more than one thread. Group chats are listed first."),
  );
  mast.append(intro);
  board.append(mast);
  const panel = el("section", "panel picker");
  library.forEach((entry) => {
    const row = el("button", "video");
    row.type = "button";
    const copy = el("span");
    const people = entry.doc.participants?.length || 0;
    const messages = entry.doc.messages?.length || 0;
    copy.append(
      el("span", "title", decodeName(entry.doc.title) || "Chat"),
      el("span", "sub", `${people} ${people === 1 ? "person" : "people"} · ${messages} messages`),
    );
    row.append(copy);
    row.addEventListener("click", () => show(analyze([entry.doc])));
    panel.append(row);
  });
  board.append(panel);
}

async function readExports(fileList) {
  const files = [...fileList];
  const parsed = [];
  for (const file of files) {
    const name = file.name.toLowerCase();
    if (name.endsWith(".zip") || file.type === "application/zip") {
      parsed.push(...(await readZip(file)));
      continue;
    }
    if (name.endsWith(".html") || file.type === "text/html") {
      parsed.push(parseHtmlThread(await file.text(), file.name.replace(/\.html$/i, "")));
      continue;
    }
    if (name.endsWith(".json") || file.type === "application/json" || name.includes("message")) {
      parsed.push(JSON.parse(await file.text()));
    }
  }
  return parsed.filter((doc) => doc && (Array.isArray(doc.messages) || Array.isArray(doc.participants)));
}

async function readZip(file) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser cannot open zip files. Unzip the download and drop the message JSON files.");
  }
  const entries = await unzip(await file.arrayBuffer());
  const htmlThreads = new Map();
  const jsonDocs = [];
  for (const [path, bytes] of entries) {
    if (/message_\d+\.json$/i.test(path)) {
      jsonDocs.push(JSON.parse(new TextDecoder().decode(bytes)));
      continue;
    }
    if (!/message_\d+\.html$/i.test(path)) continue;
    const thread = path.match(/inbox\/([^/]+)\//i)?.[1] || path;
    const list = htmlThreads.get(thread) || [];
    list.push([path, new TextDecoder().decode(bytes)]);
    htmlThreads.set(thread, list);
  }
  for (const [thread, parts] of htmlThreads) {
    parts.sort((a, b) => a[0].localeCompare(b[0]));
    const docs = parts.map(([path, html]) => parseHtmlThread(html, threadFromPath(path)));
    jsonDocs.push(mergeThreads(docs));
  }
  if (!jsonDocs.length) {
    throw new Error("Zip opened, but no inbox message file was inside. Include Messages in the export.");
  }
  return jsonDocs;
}

function mergeThreads(docs) {
  const participants = new Map();
  const messages = [];
  let title = "";
  for (const doc of docs) {
    title = title || doc.title;
    for (const person of doc.participants || []) participants.set(person.name, person);
    messages.push(...(doc.messages || []));
  }
  return { title, participants: [...participants.values()], messages };
}

async function unzip(buffer) {
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);
  let offset = 0;
  const entries = [];
  while (offset + 30 < bytes.length) {
    const sig = view.getUint32(offset, true);
    if (sig !== 0x04034b50) break;
    const method = view.getUint16(offset + 8, true);
    const compressed = view.getUint32(offset + 18, true);
    const nameLen = view.getUint16(offset + 26, true);
    const extraLen = view.getUint16(offset + 28, true);
    const name = new TextDecoder().decode(bytes.subarray(offset + 30, offset + 30 + nameLen));
    const start = offset + 30 + nameLen + extraLen;
    const slice = bytes.subarray(start, start + compressed);
    if (!name.endsWith("/")) {
      if (method === 0) entries.push([name, slice]);
      else if (method === 8) entries.push([name, await inflate(slice)]);
    }
    offset = start + compressed;
  }
  return entries;
}

async function inflate(slice) {
  const stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    size += value.length;
    if (size > 80_000_000) throw new Error("That message file is too large to open in the browser.");
  }
  const out = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function show(next) {
  report = next;
  gate.classList.add("hidden");
  resetBtn.classList.remove("hidden");
  board.classList.remove("hidden");
  render();
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function render() {
  board.replaceChildren();
  const { awards } = buildAwards(report);
  const maxHearts = Math.max(...report.people.map((p) => p.heartsReceived), 1);
  const maxVideo = Math.max(...report.videos.map((v) => v.hearts), 1);

  const mast = el("header", "mast");
  const intro = el("div");
  intro.append(
    el("p", "kicker", "The tape"),
    el("h1", null, decodeName(report.title)),
    el("p", "range", report.range ? report.range.label : "Dates missing from this export"),
  );
  const stats = el("div", "stats");
  for (const [value, label] of [
    [report.participantCount, "people"],
    [report.videos.length, report.videos.length === 1 ? "video" : "videos"],
    [report.heartTotal, report.heartTotal === 1 ? "heart" : "hearts"],
  ]) {
    const card = el("div", "stat");
    card.append(el("b", null, String(value)), el("span", null, label));
    stats.append(card);
  }
  mast.append(intro, stats);
  board.append(mast);

  const awardLabel = el("div", "section-label");
  awardLabel.append(el("h2", null, "Awards"), el("p", null, "Hearts from other people only"));
  board.append(awardLabel);

  const awardGrid = el("section", "awards");
  if (!awards.length) {
    awardGrid.append(el("p", "empty-inline", "No hearts on shared videos yet. Once the group starts reacting, the plaques show up here."));
  }
  awards.forEach((award, index) => {
    const card = el("article", `award ${award.tone}${index === 0 ? " feature" : ""}`);
    card.append(el("p", "eyebrow", award.kicker), el("h3", null, award.title), el("p", "who", award.headline), el("p", "detail", award.detail));
    if (award.videoKey) card.append(watchLink(award.videoKey));
    const figure = el("div", "figure");
    figure.append(el("b", null, award.stat), el("span", null, award.statLabel));
    card.append(figure);
    if (award.people?.length) {
      const chips = el("div", "chips");
      award.people.forEach((name) => chips.append(el("span", "chip", name)));
      card.append(chips);
    }
    if (award.items?.length > 1) {
      const list = el("ul", "mini");
      award.items.forEach((item) => {
        const li = el("li");
        if (item.key) {
          li.tabIndex = 0;
          li.role = "link";
          li.addEventListener("click", () => openVideo(item.key));
          li.addEventListener("keydown", (event) => {
            if (event.key === "Enter") openVideo(item.key);
          });
        }
        const copy = el("div");
        copy.append(el("strong", null, item.title));
        const meta = el("div");
        meta.append(document.createTextNode(item.meta));
        copy.append(meta);
        li.append(copy, el("span", null, item.value));
        list.append(li);
      });
      card.append(list);
    }
    awardGrid.append(card);
  });
  board.append(awardGrid);

  const layout = el("div", "layout");

  const peoplePanel = el("section", "panel");
  const peopleHead = el("div", "section-label");
  peopleHead.append(el("h2", null, "People"), el("p", null, "Hearts received"));
  peoplePanel.append(peopleHead);
  if (!report.people.length) {
    peoplePanel.append(el("p", "empty-inline", "No senders in this export."));
  }
  report.people.forEach((person) => {
    const row = el("button", "person");
    row.type = "button";
    row.append(el("span", "avatar", personInitials(person.name)));
    const copy = el("span");
    copy.append(el("span", "name", person.name), el("span", "sub", `${person.shares} shared · ${person.heartsGiven} given`));
    const score = el("span", "score", String(person.heartsReceived));
    score.append(el("small", null, "hearts"));
    row.append(copy, score);
    const bar = el("span", "bar");
    const fill = document.createElement("i");
    fill.style.width = `${Math.round((person.heartsReceived / maxHearts) * 100)}%`;
    bar.append(fill);
    copy.append(bar);
    row.addEventListener("click", () => openPerson(person.name));
    peoplePanel.append(row);
  });

  const videoPanel = el("section", "panel");
  const videoHead = el("div", "section-label");
  videoHead.append(el("h2", null, "Videos"), el("p", null, "Unique hearts"));
  videoPanel.append(videoHead);
  if (!report.videos.length) {
    videoPanel.append(el("p", "empty-inline", "No reels or shared videos in this export. Text-only chats still rank people above."));
  }
  report.videos.forEach((video) => {
    const row = el("button", "video");
    row.type = "button";
    const copy = el("span");
    copy.append(
      el("span", "title", video.owner),
      el("span", "sub", `${video.discoveredBy} · ${formatWhen(video.firstAt)} · ${video.caption}`),
    );
    const score = el("span", "score", String(video.hearts));
    score.append(el("small", null, video.shareCount > 1 ? `${video.shareCount} sends` : "hearts"));
    const actions = el("span", "row-actions");
    if (video.link) actions.append(watchLink(video.key, "Watch"));
    actions.append(score);
    row.append(copy, actions);
    const bar = el("span", "bar");
    const fill = document.createElement("i");
    fill.style.width = `${Math.round((video.hearts / maxVideo) * 100)}%`;
    bar.append(fill);
    copy.append(bar);
    row.addEventListener("click", () => openVideo(video.key));
    videoPanel.append(row);
  });

  layout.append(peoplePanel, videoPanel);
  board.append(layout);
}

function openPerson(name) {
  const person = report.people.find((p) => p.name === name);
  if (!person) return;
  const fans = [...person.heartGivers.entries()].sort((a, b) => b[1] - a[1]);
  const gifted = [...person.givenTo.entries()].sort((a, b) => b[1] - a[1]);
  const theirVideos = report.videos.filter((v) => v.sharers.includes(name));
  openDrawer({
    kicker: "Person",
    title: person.name,
    facts: [
      [person.heartsReceived, "hearts received"],
      [person.heartsGiven, "hearts given"],
      [person.shares, "videos shared"],
      [person.messages, "messages"],
    ],
    sections: [
      fans.length ? ["Hearted by", fans.map(([who, n]) => `${who} · ${n}`)] : null,
      gifted.length ? ["They keep hearting", gifted.map(([who, n]) => `${who} · ${n}`)] : null,
      theirVideos.length
        ? ["Their sends", theirVideos.map((v) => ({ text: `${v.owner} — ${v.hearts} hearts`, key: v.key }))]
        : ["Their sends", ["No video shares in this export."]],
    ].filter(Boolean),
  });
}

function openVideo(key) {
  const video = report.videos.find((v) => v.key === key);
  if (!video) return;
  openDrawer({
    kicker: "Video",
    title: video.owner,
    facts: [
      [video.hearts, "unique hearts"],
      [video.reactions, "reactors"],
      [video.shareCount, "times sent"],
      [video.sharers.length, "senders"],
    ],
    body: video.caption,
    link: video.link,
    embed: embedUrl(video.link),
    sections: [
      ["Sent by", video.shares.map((s) => `${s.sender} · ${formatWhen(s.timestamp)}`)],
      video.heartActors.length ? ["Hearted by", video.heartActors] : ["Hearted by", ["No hearts yet."]],
    ],
  });
}

function openDrawer(model) {
  closeDrawer();
  const back = el("button", "drawer-back");
  back.type = "button";
  back.setAttribute("aria-label", "Close details");
  const drawer = el("aside", "drawer");
  drawer.setAttribute("role", "dialog");
  drawer.setAttribute("aria-modal", "true");
  const header = document.createElement("header");
  const titles = el("div");
  titles.append(el("p", "kicker", model.kicker), el("h2", null, model.title));
  const close = el("button", "close", "×");
  close.type = "button";
  close.setAttribute("aria-label", "Close");
  header.append(titles, close);
  drawer.append(header);
  if (model.embed) {
    const frame = document.createElement("iframe");
    frame.className = "player";
    frame.src = model.embed;
    frame.title = `Instagram reel from ${model.title}`;
    frame.loading = "lazy";
    frame.allow = "autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share";
    drawer.append(frame);
  }
  if (model.body) drawer.append(el("p", "detail", model.body));
  const facts = el("div", "facts");
  model.facts.forEach(([value, label]) => {
    const cell = el("div");
    cell.append(el("b", null, String(value)), el("span", null, label));
    facts.append(cell);
  });
  drawer.append(facts);
  if (model.link) drawer.append(externalLink(model.link, "Open on Instagram"));
  model.sections.forEach(([heading, lines]) => {
    drawer.append(el("h3", null, heading));
    const list = document.createElement("ul");
    lines.forEach((line) => {
      const item = el("li");
      if (line && typeof line === "object") {
        const button = el("button", "text-link", line.text);
        button.type = "button";
        button.addEventListener("click", () => openVideo(line.key));
        item.append(button);
      } else {
        item.textContent = line;
      }
      list.append(item);
    });
    drawer.append(list);
  });
  const dismiss = () => closeDrawer();
  back.addEventListener("click", dismiss);
  close.addEventListener("click", dismiss);
  drawerRoot.append(back, drawer);
  close.focus();
  drawer.addEventListener("keydown", (event) => {
    if (event.key === "Escape") dismiss();
  });
}

function closeDrawer() {
  drawerRoot.replaceChildren();
}

function watchLink(key, label = "Watch") {
  const button = el("button", "watch", label);
  button.type = "button";
  button.addEventListener("click", (event) => {
    event.stopPropagation();
    openVideo(key);
  });
  return button;
}

function externalLink(href, label) {
  const a = document.createElement("a");
  a.className = "watch external";
  a.href = href;
  a.target = "_blank";
  a.rel = "noreferrer";
  a.textContent = label;
  return a;
}

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape") closeDrawer();
});

const params = new URLSearchParams(location.search);
const share = params.get("chat");
if (share) {
  fetch(share)
    .then((response) => {
      if (!response.ok) throw new Error("This shared chat could not be loaded.");
      return response.json();
    })
    .then((data) => show(analyze([data])))
    .catch((error) => fail(error.message || "This shared chat could not be loaded."));
}
