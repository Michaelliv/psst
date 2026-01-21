<mental>
Use `mental` to maintain the mental model as you work on the codebase.

<commands>
- `mental add domain <name>` - Add a domain (core business concept)
- `mental add capability <name>` - Add a capability (what the system does)
- `mental add aspect <name>` - Add an aspect (cross-cutting concern)
- `mental add decision <what> --why <reason>` - Record a decision
- `mental update <type> <name|id>` - Update an entity (--desc, --files, --relates-to, etc.)
- `mental supersede decision <id>` - Replace a decision with a new one (keeps history)
- `mental show` - Display the current model
- `mental view` - Open interactive visualization
</commands>

<when-to-use>
- After adding a new feature or module
- After making an architectural decision
- When introducing a new domain concept
- When adding cross-cutting concerns (auth, logging, caching)
- When the user asks to update the mental model
</when-to-use>

<guidelines>
- Domains are nouns (User, Order, Payment)
- Capabilities are verbs (Checkout, ProcessPayment, SendNotification)
- Aspects apply across capabilities (Auth, Validation, RateLimit)
- Decisions capture the "why" behind choices
- Link decisions to related entities with --relates-to
- Attach documentation with --docs (local paths or URLs)
</guidelines>
</mental>
