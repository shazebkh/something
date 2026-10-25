# Escape House

Escape House is a real-time quiz escape game set inside a changing 3D house. Move your player through a room, approach an exit object, answer its question, and race to escape.

**Play online:** https://escape-house.onrender.com  
**Repository:** https://github.com/shazebkh/something

## Getting started

Requirements: Node.js 24+ and npm.

Install dependencies with npm install, then start the app with npm run server. Open http://localhost:3000. To run the game in Docker, use docker compose up --build.

Useful commands: npm test, npm run typecheck, npm run build:client, and npm run bots -- 1000.

## Playing

The first screen introduces the controls and the room challenge. Choose a game mode and question subject from the lobby:

- **Single player** starts a solo escape.
- **Multiplayer** supports 2–8 players. The host chooses the player limit and subject, then clicks **Create room** to generate a code. Share it with players; they paste it in **Join with room code** and select **Join room**. The host can start early with fewer players than the selected limit. Text and voice chat are available while the room is waiting. Everyone shares the same starting room and house.
- Subjects include biology, physics, history, geography, psychology, physiology, chemistry, astronomy, literature, economics, and All subjects.

Move with WASD or the arrow keys, use the touch joystick, or tap/click a floor location to walk. Get close to a door, window, cupboard, or drawer to receive its question. The question card opens in the upper-right of the 3D room when you approach an exit and closes when you move away. Correct answers open the next step and change the room’s colors and decorations. Wrong answers shrink the room and add a strike.

The bundled bank contains 110 questions. Questions are graded deterministically and are not repeated for the same player during a match. Multiplayer includes room-presence avatars, match-wide text chat, and same-room push-to-talk voice. Voice requires microphone permission and HTTPS (or localhost).

## Project structure

- src/house.ts — seeded connected-house generator and shortest paths
- src/rules.ts — answer grading, strikes, shrinking, hints, scoring, and ranking
- src/server.ts — authoritative WebSocket game server
- src/client.ts — Three.js room, player movement, question overlay, and controls
- public/index.html and public/style.css — lobby, intro, room HUD, and responsive layout
- data/questions.json — bundled question bank
- src/questionAgent.ts — optional Wikipedia-sourced question generation
- db/schema.sql — PostgreSQL schema
- src/bots.ts — strategy simulator

## Optional services

The bundled questions and in-memory matches work without external services. Set DATABASE_URL to enable PostgreSQL storage for matches, users, questions, and answer events. Set OPENAI_API_KEY as a server environment variable to enable the question-generation agent; it also requires PostgreSQL. REDIS_URL enables Redis match snapshots. Never put secrets in the browser or commit them to GitHub. Copy .env.example as a guide, then configure variables in the server environment; the application does not load .env automatically.

## Hosted preview

The public preview is hosted on Render’s free service. Free instances can sleep while idle, and free Postgres databases expire after 30 days. The hosted preview currently serves the bundled question bank; generated-question storage requires database and API-key configuration.
