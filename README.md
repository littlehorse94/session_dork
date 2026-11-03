# session-dock

a little dock for claude code. it shows all my claude code sessions on this computer as icon tiles, so i can see which ones are working, which ones need me and which ones are just sitting there.

made it because i always have a few sessions open and keep losing track of which one is waiting for me.

## what you get

- a panel next to the chat with every session as a tile
- grouped into **needs you**, **working**, **idle** and **offline**
- each tile shows the folder, the branch, the last thing you asked and how long ago
- a status line at the bottom, like `2 working · 1 need you · 3 idle`
- in the claude desktop app every chat gets its own soft background, cool colours only, with frosted glass panels on top
- type `/sessions` if you close the panel and want it back

no ai calls, nothing leaves your computer. each session just writes a tiny status file to `~/.claude/session-dock/` and the dock reads that folder every few seconds.

## install

in claude code (terminal):

```
/plugin install session-dock --marketplace littlehorse94/session_dork
```

press `y` to add the marketplace, then pick the user scope.

or from a normal shell:

```
claude plugin install session-dock --marketplace littlehorse94/session_dork
```

desktop app: click **+** next to the prompt box, then **Plugins**, **Add marketplace**, type `littlehorse94/session_dork`, then **Add plugin**.

new sessions pick it up straight away. already open ones need a restart.

## good to know

- it only sees sessions on the same computer. if you use claude on two machines, each one has its own dock.
- the background only shows in the desktop app. terminal gets the panel and status line, with emoji instead of the glass icons.
- "needs you" kicks in when a permission prompt has been open for more than 1.5 sec, or when claude asks you a question.
- a session that hasn't checked in for 5 min shows as offline. closed ones disappear after an hour.

## remove it

```
claude plugin uninstall session-dock
```

then delete `~/.claude/session-dock/` if you want the status files gone too.

---

made by [littlehorse](https://github.com/littlehorse94)
