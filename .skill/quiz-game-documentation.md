# Quiz Game — Project Documentation

> A real-time, LAN-based multiplayer quiz game with 4 competing teams, host-controlled rounds, QR join system, and elimination brackets.

---

## Table of Contents

1. [Concept Overview](#1-concept-overview)
2. [Requirements Gathered](#2-requirements-gathered)
3. [Tech Stack Decision](#3-tech-stack-decision)
4. [Game Rules & Scoring](#4-game-rules--scoring)
5. [Program Flow](#5-program-flow)
6. [Architecture](#6-architecture)
7. [File Structure](#7-file-structure)
8. [Socket Event Map](#8-socket-event-map)
9. [Game State Machine](#9-game-state-machine)
10. [Screen Breakdown — Host](#10-screen-breakdown--host)
11. [Screen Breakdown — Client](#11-screen-breakdown--client)
12. [Data Schemas](#12-data-schemas)
13. [Scoring Formula](#13-scoring-formula)
14. [Known Issues & Fixes](#14-known-issues--fixes)
15. [Setup & Run Guide](#15-setup--run-guide)

---

## 1. Concept Overview

A **local-area-network (LAN) party quiz game** inspired by Kahoot, designed to run entirely offline on a single host machine. Up to **4 teams** join by scanning a QR code, then compete across **3 elimination rounds** to determine a champion.

The game is split into two distinct interfaces:

| Interface | Device | URL |
|---|---|---|
| **Host** | Laptop / Projector screen | `http://localhost:3000/host` |
| **Client** | Player's smartphone | `http://<LAN-IP>:3000` |

---

## 2. Requirements Gathered

The following decisions were confirmed through a structured Q&A session before development began.

### Game Format
| Parameter | Decision |
|---|---|
| Number of teams | 4 |
| Join method | QR code scan |
| Rounds | 3 (elimination bracket) |
| Questions per round | Round 1: 4 · Round 2: 2 · Round 3 (Final): 1 |
| Teams advancing | Round 1 → 2: top 2 · Round 2 → 3: top 2 · Winner: top 1 |

### Gameplay
| Parameter | Decision |
|---|---|
| Timer per question | Configurable in `config.json` before game starts |
| Timer default | Round 1: 30s · Round 2: 20s · Round 3: 15s |
| Answer options | 4 choices (A / B / C / D) |
| Scoring | Correct answer + time bonus (scale of 100) |
| Bar chart | Real-time % of teams per answer (shown on host) |
| Slide presentation | Static images shown between questions |

### Technical
| Parameter | Decision |
|---|---|
| Server stack | Node.js + Express + Socket.io |
| Frontend | Vanilla HTML / CSS / JavaScript |
| Network | LAN only (same WiFi) |
| Host flow control | Hybrid — auto-timer + host can pause / skip |
| Team icons | Pre-built emoji set (10 icons to pick from) |

---

## 3. Tech Stack Decision

```
Backend  →  Node.js + Express + Socket.io
Frontend →  HTML5 + CSS3 + Vanilla JS  (no framework)
QR Code  →  npm: qrcode
Real-time→  WebSocket via Socket.io
Network  →  LAN (192.168.x.x / 10.x.x.x)
```

**Why no frontend framework?**
The game runs on a single host machine with a local server. Using vanilla JS keeps the setup minimal — no build step, no bundler, no dependencies to manage beyond `npm install`.

---

## 4. Game Rules & Scoring

### Round Structure

```
Round 1 ── 4 teams ── 4 questions ── top 2 advance
Round 2 ── 2 teams ── 2 questions ── top 2 stay
Round 3 ── 2 teams ── 1 question  ── winner declared
```

### Scoring Formula

Each question is worth **100 points maximum**:

```
score = 60 (base) + 40 × (timeLeft / totalTime)   [if correct]
score = 0                                           [if wrong]
```

| Scenario | Score |
|---|---|
| Correct, answered instantly | 100 pts |
| Correct, answered at half time | 80 pts |
| Correct, answered at last second | ~61 pts |
| Wrong or no answer | 0 pts |

### Elimination

After each round ends, teams are sorted by **total cumulative score**. The bottom teams are eliminated and their client screens lock with a "Thank you" message. Eliminated teams cannot participate in subsequent rounds.

---

## 5. Program Flow

### High-Level Sequence

```
[LOBBY]
  Host opens /host → QR generated from LAN IP
  Teams scan QR → join with name + icon
  Host sees teams appear in real-time
  Host clicks "Start Game" (requires ≥ 2 teams)

[FOR EACH QUESTION]
  Server broadcasts question + timer to all
  Countdown begins (host can pause / skip)
  Clients tap one of 4 colored buttons to answer
  After all teams answer OR timer hits 0:
    → Server reveals correct answer
    → Bar chart shows % per option
    → Each client gets personal +score notification
    → Host sees ranked scoreboard
    → Host advances to slide (prev/next controls)
    → Host advances to next question

[END OF ROUND]
  Server sorts teams by score
  Bottom teams eliminated → client locked
  Remaining teams enter next round

[FINAL]
  Podium displayed: 🥇 🥈 🥉
```

### Host Control Flow (Hybrid)

```
Timer auto-counts down
  │
  ├─ Host can PAUSE at any time  →  timer freezes
  ├─ Host can SKIP               →  jumps to reveal
  └─ Timer hits 0                →  auto-reveals
```

---

## 6. Architecture

### System Diagram

```
┌─────────────────────────────────────────────────────┐
│                   HOST MACHINE                       │
│                                                     │
│  ┌──────────────┐     ┌──────────────────────────┐  │
│  │  Node.js     │     │  Browser (host view)     │  │
│  │  server.js   │◄───►│  /host/index.html        │  │
│  │              │     │  Socket.io client        │  │
│  │  Express     │     └──────────────────────────┘  │
│  │  Socket.io   │                                   │
│  │  QRCode      │                                   │
│  └──────┬───────┘                                   │
│         │  LAN (192.168.x.x:3000)                   │
└─────────┼───────────────────────────────────────────┘
          │
    ──────┼──── WiFi Router ────
          │
   ┌──────┴──────────────────────────────────────┐
   │          PLAYER DEVICES (up to 4)            │
   │                                             │
   │  📱 Phone A    📱 Phone B    📱 Phone C    📱 Phone D  │
   │  /client       /client       /client       /client  │
   │  Socket.io  Socket.io  Socket.io  Socket.io  │
   └─────────────────────────────────────────────┘
```

### Communication Model

All state is **server-authoritative**. Clients only send: join requests and answer submissions. The server manages all timers, scoring, and phase transitions — clients and host are pure renderers of server-emitted state.

---

## 7. File Structure

```
quiz-game/
│
├── server.js                   # Game engine: Express + Socket.io + state machine
├── config.json                 # Round config, timer, colors, icon names
├── questions.json              # All questions organized by round
├── package.json
│
└── public/
    ├── host/
    │   └── index.html          # Host master screen (all game phases)
    │
    ├── client/
    │   └── index.html          # Player screen (join → answer → result)
    │
    ├── shared/
    │   └── style-base.css      # Shared design system (colors, fonts, animations)
    │
    └── assets/
        ├── icons/              # (optional) SVG icon files
        └── slides/             # Static slide images (e.g. slide_01.jpg)
                                # Filename must match "slide" field in questions.json
```

---

## 8. Socket Event Map

### Client → Server

| Event | Payload | Description |
|---|---|---|
| `join_team` | `{ name, icon }` | Register a team name and chosen icon |
| `submit_answer` | `{ answer }` | Submit answer index (0–3) |

### Host → Server

| Event | Payload | Description |
|---|---|---|
| `host_join` | — | Host authenticates; triggers QR generation |
| `host_regen_qr` | `{ ip }` | Regenerate QR for a different LAN IP |
| `host_action` | `{ action, data }` | Control game flow (see actions below) |

#### `host_action` values

| Action | Trigger |
|---|---|
| `start_game` | Begin Round 1 |
| `pause` | Toggle timer pause/resume |
| `skip` | Force-end countdown → reveal answers |
| `next_after_reveal` | Reveal → Scoreboard |
| `show_slide` | Scoreboard → Slide |
| `next_question` | Slide → next question (or round end) |
| `prev_slide` / `next_slide` | Navigate static slide pages |
| `next_round` | Elimination → start next round |
| `show_final` | Go directly to final podium |
| `reset` | Reset entire game state → Lobby |

### Server → All

| Event | Payload | Description |
|---|---|---|
| `game_state` | `{ phase, ...data }` | Master state broadcast — drives all screens |
| `timer_tick` | `{ timeLeft, totalTime }` | Every second during countdown |
| `team_update` | `{ teams[] }` | Lobby team list changed |
| `answer_stats` | `[{ index, count, percent, isCorrect }]` | Live bar chart update |
| `game_paused` | `{ paused }` | Pause state changed |
| `game_reset` | — | Game wiped, return to lobby |

### Server → Individual Client

| Event | Payload | Description |
|---|---|---|
| `init` | `{ phase, teams, config, lanIP, port }` | Sent on connect |
| `join_success` | `{ team, id }` | Confirm team registered |
| `join_rejected` | `{ reason }` | Room full or game in progress |
| `answer_received` | `{ answer }` | Confirm answer logged |
| `personal_result` | `{ isCorrect, score, totalScore }` | Per-client result after reveal |
| `eliminated` | `{ message }` | Team is out — lock client screen |

### Server → Host Only

| Event | Payload | Description |
|---|---|---|
| `host_ready` | `{ qrDataUrl, url, allIPs, port, teams, config }` | QR image + IP list |
| `qr_updated` | `{ qrDataUrl, url }` | QR regenerated for new IP |

---

## 9. Game State Machine

```
            ┌──────────┐
            │   MAIN   │ 
            │   SLIDE  │ 
            └────┬─────┘
                 │ button next / click mouse
                 ▼          
            ┌──────────┐
            │  LOBBY   │ ◄── reset
            └────┬─────┘
                 │ start_game
                 ▼
          ┌─────────────┐
          │  QUESTION   │ ◄──────────────────┐
          └──────┬──────┘                    │
                 │ timer end / skip          │
                 ▼                           │
          ┌─────────────┐                    │
          │   REVEAL    │                    │
          └──────┬──────┘                    │
                 │ next_after_reveal          │
                 ▼                           │
          ┌─────────────┐                    │
          │ SCOREBOARD  │                    │
          └──────┬──────┘                    │
                 │ show_slide                │
                 ▼                           │
          ┌─────────────┐                    │
          │    SLIDE    │                    │
          └──────┬──────┘                    │
                 │ next_question             │
                 ├───────────────────────────┘  (more questions in round)
                 │
                 ▼  (round complete)
          ┌─────────────┐
          │ ELIMINATION │
          └──────┬──────┘
                 │ next_round
                 ├───────────────► QUESTION (next round starts)
                 │
                 ▼  (after final round)
          ┌─────────────┐
          │    FINAL    │
          └─────────────┘
                 │
                 ▼  button next / click mouse
          ┌─────────────┐
          │  SUMMARY    │
          │  SLIDE      │
          └─────────────┘
                 │
                 ▼  button next / click mouse
          ┌─────────────┐
          │   THANKYOU  │
          └─────────────┘
                 │
                 ▼  reset button
          ┌─────────────┐
          │   LOBBY     │
          └─────────────┘
```

---

## 10. Screen Breakdown — Host

| Phase | What's displayed |
|---|---|
| **LOBBY** | QR code + URL · IP selector dropdown · Team slots (fill in real-time) · Start button |
| **QUESTION** | Round badge · Question counter · Countdown ring timer · Question text · 4 colored answer tiles with live bar charts · Team answer-status chips |
| **REVEAL** | Answer tiles highlighted (correct in focus) · Bar chart % finalized · Mini scoreboard |
| **SCOREBOARD** | Full ranked list with medals 🥇🥈🥉 · Animated stagger entry |
| **SLIDE** | Fullscreen static image · Prev / Next slide buttons · "Next Question" button |
| **ELIMINATION** | Advancing teams (highlighted) · Eliminated teams (greyed, strikethrough) |
| **FINAL** | Podium 🥇🥈🥉 with team icons, names, and total scores |

### Host Control Bar (always visible)

```
[ Phase Indicator ]  [ ⏸ Pause ]  [ ⏭ Skip ]  [ → Next ]  [ 🔄 Reset ]
```

Buttons shown/hidden contextually per phase.

---

## 11. Screen Breakdown — Client

| Phase | What's displayed |
|---|---|
| **JOIN** | Icon picker grid (10 emojis) · Team name input · Join button |
| **LOBBY** | Team badge (icon + name + color glow) · "Waiting for host" with animated dots · Team count |
| **QUESTION** | Round badge · Progress (Q n/N) · Countdown arc timer · 4 large colored buttons (A/B/C/D) |
| **WAIT** | "Answer submitted — waiting for others" |
| **RESULT** | ✅/❌ icon · "Correct!" or "Wrong" · `+score` pop animation · Total score |
| **ELIMINATED** | 💀 icon · "You have been eliminated" · Thank you message · Screen locked |

### Client Answer Colors

| Button | Color |
|---|---|
| A | 🔴 Red `#FF4757` |
| B | 🟢 Green `#2ED573` |
| C | 🔵 Blue `#1E90FF` |
| D | 🟠 Orange `#FFA502` |

---

## 12. Data Schemas

### `config.json`

```json
{
  "rounds": [
    { "round": 1, "teamsCount": 4, "questions": 4, "timer": 30, "advanceCount": 2 },
    { "round": 2, "teamsCount": 2, "questions": 2, "timer": 20, "advanceCount": 2 },
    { "round": 3, "teamsCount": 2, "questions": 1, "timer": 15, "advanceCount": 1 }
  ],
  "scoring": {
    "baseScore": 60,
    "timeBonus": 40
  },
  "icons": ["dragon","lion","wolf","eagle","fox","bear","tiger","shark","owl","phoenix"],
  "teamColors": ["#FF4757", "#2ED573", "#1E90FF", "#FFA502"],
  "slidesBetweenQuestions": true
}
```

### `questions.json`

```json
{
  "questions": [
    {
      "id": 1,
      "round": 1,
      "text": "Question text here?",
      "answers": ["Option A", "Option B", "Option C", "Option D"],
      "correct": 0,
      "slide": "slide_01.jpg"
    }
  ]
}
```

| Field | Type | Notes |
|---|---|---|
| `round` | 1 / 2 / 3 | Which round this question belongs to |
| `correct` | 0–3 | Index of the correct answer |
| `slide` | string | Filename in `public/assets/slides/` |

### In-memory Team Object (server)

```js
{
  name: "Team Dragon",       // max 20 chars
  icon: "dragon",            // key from config.icons
  color: "#FF4757",          // assigned by join order
  score: 240,                // cumulative total
  roundScore: 80,            // current round only
  eliminated: false
}
```

---

## 13. Scoring Formula

```
MAX_SCORE  = baseScore + timeBonus = 60 + 40 = 100
SCORE(t)   = 60 + floor(40 × timeLeft / totalTime)   if correct
           = 0                                         if wrong or no answer
```

**Examples** (30-second timer):

| Answered at | timeLeft | Score |
|---|---|---|
| 0s (instantly) | 30 | 100 pts |
| 10s elapsed | 20 | 87 pts |
| 20s elapsed | 10 | 73 pts |
| 29s elapsed | 1 | 61 pts |
| Time's up / wrong | 0 | 0 pts |

---

## 14. Known Issues & Fixes

### QR Code Not Displaying

**Root cause:** `getLanIP()` picked the wrong interface (VPN, Docker bridge, VMware adapter) over the real WiFi IP.

**Fix applied:**
1. `getLanIP()` now prioritizes `192.168.x.x` → `10.x.x.x` → `172.x.x.x`
2. Host screen shows a **dropdown to switch IP** if multiple interfaces are detected
3. `host_regen_qr` socket event allows real-time QR regeneration without page reload
4. QR `img` element has `onload` / `onerror` handlers with a text-URL fallback

**If QR still fails:** Use the IP selector dropdown on the host screen, or manually type the URL shown below the QR into phone's browser.

---

## 15. Setup & Run Guide

### Prerequisites

- **Node.js v16+** — [nodejs.org](https://nodejs.org) (download LTS)
- All devices on the **same WiFi network**

### Install

```bash
# 1. Enter project folder
cd quiz-game

# 2. Install dependencies
npm install
```

### Run

```bash
node server.js
```

Terminal output:
```
╔══════════════════════════════════════╗
║        🎮 QUIZ GAME SERVER           ║
╠══════════════════════════════════════╣
║  Host  : http://192.168.x.x:3000/host
║  Client: http://192.168.x.x:3000
╚══════════════════════════════════════╝
```

### Open Screens

| Who | Opens | How |
|---|---|---|
| Host operator | `http://localhost:3000/host` | On the machine running server |
| Players | `http://192.168.x.x:3000` | Scan QR on host screen |

### Add Content

| Task | How |
|---|---|
| Add questions | Edit `questions.json` — set `"round": 1/2/3` |
| Change timer | Edit `config.json` → `rounds[n].timer` (seconds) |
| Add slides | Drop image files into `public/assets/slides/` · Match filename to `"slide"` field in questions |
| Adjust score | Edit `config.json` → `scoring.baseScore` and `scoring.timeBonus` (must sum ≤ 100) |

### Troubleshooting

| Problem | Solution |
|---|---|
| QR doesn't work | Use IP dropdown on host screen to select `192.168.x.x` |
| Phone can't connect | Confirm phone and laptop are on same WiFi |
| "Room full" message | Max 4 teams — one phone per team |
| Questions don't appear | Check `round` field matches current round number in `questions.json` |
| Slide shows placeholder | Filename in `"slide"` field must exactly match file in `public/assets/slides/` |

---

*Generated from design discussions — Quiz Game v1.0*
