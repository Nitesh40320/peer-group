# model

The "smart" parts of PeerConnect, kept separate from the web server so they are easy to find, read and test.

| File | What it does |
|---|---|
| `src/matching.ts` | Scores how well two students fit as study partners and explains why in plain English. Simple weighted rules, not machine learning. |
| `src/assistant.ts` | The optional AI study assistant: the instructions given to Claude and the call to the Claude API. |
| `src/index.ts` | Lists what other parts of the project may import. |

**Rules for this folder:** no database, no HTTP, no user accounts. Functions take plain data in and give plain data back.
The backend handles everything else (who may call the assistant, daily limits, error messages).

**Using it from the backend:**

```ts
import { activeMatcher, createAssistant } from '@peerconnect/model';
```

You do not need to build this package while developing; the backend reads the TypeScript source directly.
`npm run build` (from the project root) compiles it into `dist/` for production.
