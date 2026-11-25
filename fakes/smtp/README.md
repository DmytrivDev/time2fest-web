# Fake SMTP

For tests of SPEC-10 (mail fallback, AC-37/38/53/55). `node:net`, no dependencies, no TLS. Tests start it in-process with `startFakeSmtp({ port: 0 })` (127.0.0.1); the stack runs it as compose service `fake-smtp` on `127.0.0.1:2525` (`node fakes/smtp/server.mjs --port 2525 --host 0.0.0.0` inside the container).

Speaks EHLO/HELO, AUTH PLAIN|LOGIN, MAIL FROM, RCPT TO, DATA, RSET, NOOP, QUIT. Login user `bad` → `535 5.7.8` (Nodemailer `EAUTH`); any other user is accepted.

Behaviour by the tag in the recipient's local part (`name+<tag>@example.test`; the first recipient decides for DATA):

| Tag | Answer | Nodemailer error |
|---|---|---|
| `+q451` | `451 4.7.1 Daily sending quota exceeded` after DATA | `EMESSAGE`, `responseCode 451` |
| `+q550` | `550 5.7.1 daily quota exceeded` after DATA | `EMESSAGE`, `responseCode 550` |
| `+rate` | `451 4.7.1 Too many requests` after DATA | `EMESSAGE`, `responseCode 451` |
| `+rcpt550` | `550 5.1.1 No such user` at RCPT TO | `EENVELOPE`, `responseCode 550` |
| `+slow` | no answer to DATA for 10 s | `ETIMEDOUT` with a short `socketTimeout` |
| none / other | `250`, message kept in memory | — |

`messages()` returns accepted messages `{from, to, raw, at}`; `connections()` returns transactions `{id, rcptHashes, tag, outcome, at}` with recipients hashed. Nothing about recipients or bodies is printed. Use only made-up `*.test` addresses.
