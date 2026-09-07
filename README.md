# Aether Backend

Accounts + cloud-saved paintings for [Aether](../aether-react) (the
React hand-tracking painter). This is the only part of Aether with a
server — the painting/hand-tracking itself still runs entirely in the
browser; this backend only handles signup/login and storing/listing
saved paintings.

## Stack

- FastAPI + SQLModel (async)
- SQLite for local dev, Postgres for production (just change `DATABASE_URL`)
- Sessions via an httpOnly cookie + JWT, with the same CSRF
  double-submit pattern, bcrypt_sha256 password hashing, and rate
  limiting already used and verified in the Nexus project — this isn't
  new/experimental auth code, it's the same approach proven there.

## Run it locally

```bash
pip install -r requirements.txt
cp .env.example .env   # edit ALLOWED_ORIGINS if your frontend runs elsewhere
uvicorn app.main:app --reload
```

The API is now at `http://localhost:8000`. Interactive docs at
`http://localhost:8000/docs`.

## Run the tests

```bash
pytest
```

10 tests cover signup/login/logout, wrong-password rejection, rate
limiting, saving/listing/fetching/deleting drawings, CSRF enforcement,
and that one user can never read or delete another user's drawing.

## Environment variables

See `.env.example`. The only one you must change for production is
`JWT_SECRET` — generate a real one:
```bash
python3 -c "import secrets; print(secrets.token_urlsafe(48))"
```

## API

| Method | Path | Auth required | Purpose |
|---|---|---|---|
| POST | `/api/auth/signup` | no | Create an account |
| POST | `/api/auth/login` | no | Sign in |
| POST | `/api/auth/logout` | yes | Clear session |
| GET | `/api/auth/me` | yes | Current user info |
| POST | `/api/drawings` | yes | Save a painting (PNG as base64 + tool/color/thickness) |
| GET | `/api/drawings` | yes | List your saved paintings (metadata only, no image data — keeps the gallery listing fast) |
| GET | `/api/drawings/{id}` | yes | Fetch one painting's full image |
| DELETE | `/api/drawings/{id}` | yes | Delete a painting |

State-changing requests (`POST`/`DELETE`, except signup/login which
don't have a session yet) require an `X-CSRF-Token` header matching the
`aether_csrf` cookie's value — the frontend's `apiFetch` helper does
this automatically.

## Deploying

### Render (recommended — free tier available)
1. New → Web Service → connect this repo.
2. **Build Command**: `pip install -r requirements.txt`
3. **Start Command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
4. Add a free Postgres instance (Render → New → PostgreSQL), copy its
   **Internal Database URL** into this service's `DATABASE_URL` env var
   (SQLite's file gets wiped on every redeploy on Render, so don't use
   it in production).
5. Set `JWT_SECRET` (a real random one), `ALLOWED_ORIGINS` (your
   deployed frontend's URL), `COOKIE_SECURE=true`, and
   `TRUST_PROXY_HEADERS=true` (Render's own proxy sets
   `X-Forwarded-For` correctly, so this is safe to enable there).

### Then point the frontend at it
In the frontend's Vercel/Netlify project, set `VITE_API_BASE` to this
backend's deployed URL, and redeploy the frontend.
