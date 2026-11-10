# frontend

The website users see (React + Vite). It runs on http://localhost:5173 during development and
forwards `/api` requests to the backend.

| Path | What it does |
|---|---|
| `src/main.tsx` | Starts the React app |
| `src/App.tsx` | The list of pages (routes) |
| `src/pages/` | One file per area: Landing, Auth, People, Groups, Work, Guidance, Admin, Public |
| `src/components/` | Reusable pieces: buttons, forms, layout shell, chat, task board |
| `src/lib/api.ts` | The only code that talks to the backend |
| `src/lib/auth.tsx` | Who is signed in, and live updates |
| `public/` | Images and icons served as-is |

The frontend never imports from `backend/` or `model/`; it only calls the backend's HTTP API.
