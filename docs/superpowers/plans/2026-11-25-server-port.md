# Server connection settings implementation plan

**Goal:** Configure the Minecraft public host and port in Options. Accept a domain or IP, append nondefault ports, and omit 25565.

**Architecture:** Persist optional overrides in panel state; existing installations keep their environment defaults. Feed the effective port into the runtime spec and publish the effective address. Keep Minecraft listening on internal port 25565, repairing a conflicting property before launch through confined file access. Use the existing Options styles and an explicit Save button for the connection fields.

**Tech stack:** TypeScript, Fastify, React, node:test, FakeRuntime.

- [x] Add failing API tests for defaults, host formats, validation, persistence, offline restrictions, runtime port changes and property repair.
- [x] Implement state overrides, host validation and formatting, environment API fields, and launch preparation.
- [x] Add an accessible connection form to Options with offline and saving states, firewall guidance and the Cloudflare limitation.
- [x] Update README, run typecheck, both test suites and build, then inspect the interface on a disposable fake instance and clean it up.

**Verification:** Typecheck and production build passed. All 49 server tests and 8 web tests passed. Browser checks covered saving and reloading an IP with a custom port, a domain with a custom port, Connect, and omission of the default port. No browser errors or horizontal overflow appeared at 1440 pixels. Review caught and resolved duplicate internal port properties, legacy addresses with explicit ports, and percent escapes in hosts, with regression coverage. The disposable fake panel and browser were stopped and their data removed. Real Docker networking and player connections were not exercised.

**Review focus:** No real Minecraft actions, no property environment variables, no RCON exposure, no commits or deployment. Check IPv6 formatting, environment fallback and preservation of unrelated properties.
