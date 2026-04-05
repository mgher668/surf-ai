# Security Checklist

- [ ] Bridge binds only to `127.0.0.1` by default.
- [ ] Token auth (`SURF_AI_TOKEN`) enabled for non-dev usage.
- [ ] Extension requests only required permissions.
- [ ] No remote hosted code is executed inside extension contexts.
- [ ] Connection tokens are never logged.
- [ ] Errors returned by bridge do not leak secrets.
- [ ] Session data persistence location is documented (`storage.local` + IndexedDB).
- [ ] TTS/API integration keeps credentials in bridge, not in content script.
- [ ] In shared-backend mode, all session/message queries are user-scoped.
- [ ] Backend auth is mandatory in shared-backend mode (no anonymous write APIs).
- [ ] Provider session IDs (`codex`/`claude`) are stored server-side only, not exposed to other users.
- [ ] Context retrieval/handoff never crosses `user_id + session_id` boundary.
