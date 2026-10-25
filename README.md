# Escape House MVP

A TypeScript real-time multiplayer quiz escape game with a seeded house generator, rules engine, authoritative WebSocket server, Three.js client, 110-question JSON bank, optional PostgreSQL/Redis persistence and a Wikipedia/OpenAI question agent, and bot simulator.

## Requirements and setup

- Node.js 24+
- npm
- Optional Redis and PostgreSQL services

Install dependencies with npm install. Run npm test, npm run typecheck and npm run build:client.

## Run and play

Start with npm run server and open http://localhost:3000. Move with WASD or arrow keys, drag the touch joystick, or click/tap a floor location to walk there. Roommates appear as moving avatars when they share your room. In multiplayer, match chat reaches all players and push-to-talk voice connects players in the same room. Voice requires microphone permission and a secure context (HTTPS or localhost). Exit objects show their question when you get close; clicking an object or pressing E also requests its question. Answer in the side panel. Correct answers move you to the next room and reroll its floor texture and decorative objects.

Choose **Single player** to start a solo run immediately in LIVE phase, with no calibration wait. Choose **Multiplayer** to share a match code; multiplayer lets you choose a target of 2–8 players before joining. Share the match code and the selected player count so everyone joins the same lobby. The match begins when that many players join. PORT changes the HTTP/WebSocket port. MATCH_MS defaults to 900,000 ms (15 minutes, including calibration); CALIBRATION_MS defaults to 90,000 ms. These duration variables can be shortened for local smoke tests.

The client source is src/client.ts and compiles to public/client.js. The server serves the installed Three.js module files from /vendor. Install dependencies before starting the server.

The first player to create a multiplayer match is its host and selects the question subject in the lobby. All players joining that code receive questions only from that subject. In single-player, choose your own subject. The selector includes All subjects and the ten subjects in the bundled bank. A subject pool is finite; once a player has used all its questions, the game reports exhaustion rather than repeating a question.

Correct answers send a room-clear popup to every other connected player. The host's selected subject and player count are stored with the match.

## Docker and public hosting

Build and run locally with Docker Compose: `docker compose up --build`. The app listens on port 3000 and answers `/healthz` for host health checks. For public deployment, build the included Dockerfile on a container host that supports persistent WebSockets, provide PostgreSQL as `DATABASE_URL`, and set `OPENAI_API_KEY` if generated questions are wanted. Do not publish API keys in the image or source.

## Optional persistence

Without environment variables, match state stays in process memory and the bundled 110-question bank is used. Set REDIS_URL to snapshot each live match in Redis. Set DATABASE_URL to a PostgreSQL connection string; startup creates or migrates the schema, seeds bundled questions, and loads previously generated AI questions. answer_events records server-measured answer latency and correctness.

Copy .env.example values into the server environment (the app does not load .env files automatically). Set OPENAI_API_KEY as a server environment variable to enable the background question agent; set OPENAI_MODEL to override the default model. The agent fetches a random English Wikipedia article, creates one source-grounded MCQ with structured output and a verbatim supporting quote, validates the answer choices and quote, then stores the question and source link in PostgreSQL. New questions are served immediately and randomly alongside the existing bank. The default generation interval is 10 minutes; configure QUESTION_AGENT_INTERVAL_MS to change it (minimum 60 seconds). Both PostgreSQL and an API key are required. Keep the key on the server; it is never sent to clients.

## Project layout

- src/house.ts — seeded graph generation, validation, shortest paths, teleport pools
- src/rules.ts — rules transitions, scoring, difficulty and ranking
- src/server.ts — WebSocket protocol, match phases, question delivery and authoritative grading
- src/matchMode.ts — single-player and configurable multiplayer lobby rules
- src/questionAgent.ts — Wikipedia retrieval, structured AI question creation and source validation
- src/client.ts and public/client.js — Three.js room, animated third-person player avatars, keyboard, pointer and touch joystick controls, multiplayer room presence, match chat, push-to-talk voice, proximity-triggered questions, procedural room colors and props
- src/bots.ts — simulator (1,000 matches by default; run with npm run bots -- 1000)
- data/questions.json — 110 deterministic MCQ and fill-in questions, including added sourced psychology questions
- db/schema.sql — users, matches, sourced question records and answer event tables

## Bot simulation

The simulator runs six players per match, two per strategy, for 1,000 matches by default. It prints strategy win rates, escape rate and average match length. This is a simple balance probe, not a predictive model of human play. A run in this environment reported:

    door-only    25.8% wins
    drawer-only   4.0% wins
    hint-heavy   70.2% wins
    Escaped      96.0% before the limit
    Average      2.99 minutes

Hint-heavy bots won most often in this simulation. Consider the hint cost and answer-accuracy balance before treating these win rates as balanced.

## Protocol and authority

Clients send join_match, move, choose_exit, submit_answer, request_hint, chat, voice_ready and voice_signal. The server sends room_update, players_update, chat_message, voice_signal, teleport, crushed, leaderboard_update and match_end. Text chat is match-wide; voice signaling is limited to players sharing a room. Answer keys, hints before request, question timestamps, elapsed timing and match timer calculations stay server-side. Grading uses normalized deterministic string equality.



