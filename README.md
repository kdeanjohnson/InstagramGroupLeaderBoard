# Group tape

Awards for an Instagram group chat: universally liked videos, the most popular send, and who collects the most hearts from everyone else.

Everything runs in the browser. The export never leaves the tab.

## Get the chat

1. Instagram → **Settings → Accounts Center → Your information and permissions → Export your information**.
2. Choose **JSON**, include **Messages**, range **All time**.
3. When the download arrives, drop the zip on the page. JSON and HTML both work. A download with several chats asks which thread to score.

Path inside the zip:

```
your_instagram_activity/messages/inbox/<thread>/message_1.json
```

Hearts you put on your own message are ignored. A video counts as universally liked when every other person in the thread hearted it.

End-to-end encrypted chats are not in this export. Deleted and vanished messages are gone too.

## Run

Open `index.html` from a local server so the sample chat can load:

```
python -m http.server 8765
```

Then visit `http://localhost:8765`.
