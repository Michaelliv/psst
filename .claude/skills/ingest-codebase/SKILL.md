---
name: ingest-codebase
description: Guide the creation of a high-quality mental model for a codebase. Use when starting a new mental model, when the model feels incomplete or unclear, or when onboarding to understand a system's architecture. Produces domains, capabilities, aspects, and architectural decisions.
---

# Ingest Codebase - Mental Model Creation

Create a comprehensive mental model that captures how a system *actually works* - not just what files exist, but the conceptual boundaries, responsibilities, decisions, and **connections** that shape it.

## When to Use

- Starting a new mental model for a codebase
- The existing model feels incomplete or shallow
- Onboarding to understand a system's architecture
- After major changes to verify the model is still accurate

## Philosophy

A good domain model answers:
- "What are the core *things* this system deals with?" → **Domains**
- "What can this system *do*?" → **Capabilities** (with `--operates-on` connections!)
- "What concerns cut *across* multiple parts?" → **Aspects** (with `--applies-to` connections!)
- "Why was it built *this way*?" → **Decisions**

**CRITICAL**: Every capability MUST have `--operates-on` linking it to domains. Every aspect MUST have `--applies-to`. Orphan entities indicate incomplete modeling.

---

## Phase 1: Rapid Codebase Survey (Launch 5-10 Agents in Parallel)

Before modeling, understand the codebase structure. **Launch parallel agents** to explore different aspects simultaneously:

```
Agent 1: "Read README.md, package.json, and entry points. What problem does this solve? Who are the users?"
Agent 2: "List all top-level directories. What's in each? (src/, lib/, apps/, packages/, etc.)"
Agent 3: "Find configuration files (*.config.*, .env*, etc.). What can be configured?"
Agent 4: "Search for 'export class' or 'export function' in key directories. What are the main abstractions?"
Agent 5: "Look for test directories. What's being tested? This reveals important functionality."
Agent 6: "Search for API routes, CLI commands, or event handlers. What are the entry points?"
Agent 7: "Look for database models, schemas, or types. What data does this system manage?"
Agent 8: "Search for external integrations (HTTP clients, SDKs, third-party services)."
```

**Output**: A map of the codebase with preliminary domain candidates.

---

## Phase 2: Deep Domain Exploration (Launch 10-20 Agents in Parallel)

For each potential domain area discovered in Phase 1, **launch a dedicated agent**:

```
For EACH major directory or subsystem, launch an agent with this prompt:

"Thoroughly explore [DIRECTORY] in [REPO_PATH]. Answer:
1. What domain concepts exist here? (nouns - things with identity)
2. What capabilities does it provide? (verbs - actions that can be performed)
3. What does this area depend on? (imports, calls to other modules)
4. What depends on this area? (who imports/uses this)
5. What architectural decisions are visible? (patterns, trade-offs)
6. List key files and their purposes.
Be comprehensive - read the actual code, don't just list files."
```

**Example for a large codebase with 15 directories:**
```
Launch 15 agents in parallel, one for each:
- src/auth/
- src/users/
- src/payments/
- src/notifications/
- src/api/
- src/database/
- apps/web/
- apps/mobile/
- packages/shared/
- packages/ui/
- src/infrastructure/
- src/integrations/
- src/jobs/
- scripts/
- etc.
```

**Each agent should return:**
- 2-5 domain candidates with descriptions
- 3-10 capability candidates with what domains they operate on
- 1-3 aspect candidates (cross-cutting concerns)
- 2-5 notable architectural decisions

---

## Phase 3: Build the Mental Model

Based on agent findings, create entities using the `mental` CLI:

### Domains (Nouns - Core Business Concepts)

```bash
mental add domain <Name> \
  --desc "What it represents, its lifecycle, key attributes" \
  --files "path/to/key/files.ts,another/file.ts"
```

**Good domains:**
- Have clear boundaries ("this is a User, that is a Session")
- Are spoken about by stakeholders (ubiquitous language)
- Would exist even if you rewrote the code
- Typically 8-15 domains for a medium/large codebase

**Anti-patterns to avoid:**
- "Utils", "Helpers", "Services" - code organization, not domains
- "Data", "Info" - too generic
- Implementation details ("RedisCache", "PostgresStore")

### Capabilities (Verbs - What the System Does)

```bash
mental add capability <Name> \
  --desc "What it does, when it's triggered" \
  --files "path/to/implementation.ts" \
  --operates-on "Domain1,Domain2,Domain3"
```

**CRITICAL**: Always include `--operates-on` to connect capabilities to domains!

After adding, verify with:
```bash
mental update capability <Name> --operates-on "Domain1,Domain2"
```

**Good capabilities:**
- Describe behavior, not structure (e.g., "AuthenticateUser" not "AuthService")
- Have clear inputs and outputs
- Typically 15-30 capabilities for a medium/large codebase

### Aspects (Cross-Cutting Concerns)

```bash
mental add aspect <Name> \
  --desc "What cross-cutting concern it addresses" \
  --files "path/to/implementation.ts" \
  --applies-to "Capability1,Domain2,Capability3"
```

**CRITICAL**: Always include `--applies-to` to show what the aspect affects!

**Good aspects:**
- Affect behavior of multiple capabilities
- Are "-ilities": security, reliability, observability, caching, logging
- Typically 5-10 aspects for a medium/large codebase

### Decisions (The Why)

```bash
mental add decision "<What was decided>" \
  --why "Rationale, constraints, trade-offs"
```

Capture at least 5-10 significant architectural decisions.

---

## Phase 4: Verify Completeness (Launch 5-10 Verification Agents)

After initial modeling, **launch verification agents** to find gaps:

```
Agent 1: "List all domains in the mental model. For each, what capabilities operate on it?
         Flag any domains with zero capabilities - these are orphans that need capabilities added."

Agent 2: "List all capabilities. Do they all have operates-on connections?
         Flag any without connections and suggest which domains they should connect to."

Agent 3: "List all aspects. Do they all have applies-to connections?
         Flag any without connections and suggest what they should apply to."

Agent 4: "Compare the directory structure to the mental model.
         Are there major directories not covered by any domain? List gaps."

Agent 5: "Review the decisions captured. Are there obvious architectural patterns
         (monorepo, microservices, event-driven, etc.) not documented? What's missing?"

Agent 6: "For each domain, are there CRUD-like capabilities? (Create, Read, Update, Delete, List)
         Many domains should have management capabilities - flag domains that seem incomplete."
```

### Quality Checklist

Before considering the model complete:

- [ ] **Coverage**: Every significant directory maps to at least one entity
- [ ] **No orphan domains**: Every domain has at least one capability operating on it
- [ ] **No orphan capabilities**: Every capability has `--operates-on` connections
- [ ] **No orphan aspects**: Every aspect has `--applies-to` connections
- [ ] **Decisions captured**: At least 5-10 architectural decisions documented
- [ ] **Reasonable granularity**: 8-15 domains, 15-30 capabilities for medium codebase
- [ ] **Grounded in code**: Entities map to real files, not theoretical concepts

---

## Phase 5: Fill Gaps (Iterate Until Complete)

If gaps are found, **launch targeted agents** to fill them:

```
"Domain X has no capabilities. Explore the files for X and find what actions/operations
 can be performed on it. Look for: create, update, delete, list, validate, transform, etc."

"Capability Y has no operates-on. Read the implementation and determine which domains
 it actually works with. What data does it read? What does it modify?"

"Directory Z is not covered by the model. Explore it thoroughly and determine if it
 represents a new domain, capabilities for existing domains, or cross-cutting aspects."
```

Use `mental update` to fix connections:
```bash
mental update capability <Name> --operates-on "Domain1,Domain2"
mental update aspect <Name> --applies-to "Capability1,Domain2"
```

---

## Scaling Guidelines

| Codebase Size | Domains | Capabilities | Aspects | Decisions | Total Agents |
|---------------|---------|--------------|---------|-----------|--------------|
| Small (<50k LOC) | 4-8 | 10-20 | 3-5 | 3-5 | 10-15 |
| Medium (50-200k) | 8-15 | 20-40 | 5-10 | 5-10 | 20-30 |
| Large (200k+) | 12-20 | 30-60 | 8-15 | 10-20 | 30-50 |

**Don't be afraid to launch many agents** - parallel exploration is much faster than sequential.

---

## Example: Ingesting a 300k+ LOC Codebase

**Phase 1** (8 agents in parallel): Quick survey → identify ~20 potential areas
**Phase 2** (20 agents in parallel): Deep dive each area → raw findings
**Phase 3**: Synthesize into 15 domains, 35 capabilities, 8 aspects, 12 decisions
**Phase 4** (6 agents in parallel): Verify completeness → find 8 gaps
**Phase 5** (8 agents in parallel): Fill gaps → add missing connections

**Total: ~42 agent launches, model complete in one session**

---

## Common Mistakes

1. **Not launching enough agents** - One agent can't thoroughly explore a large codebase
2. **Missing `--operates-on`** - Capabilities without domain connections are useless
3. **Missing `--applies-to`** - Aspects without targets don't show their impact
4. **Too shallow** - "Auth" as single capability vs. "Login, Logout, TokenRefresh, PasswordReset, SessionManagement"
5. **Modeling code structure** - Avoid "Controllers", "Services", "Repositories" as domains
6. **Skipping verification** - Always run verification agents to catch gaps
7. **Not iterating** - First pass is never complete; plan for 2-3 rounds

---

## mental CLI Quick Reference

```bash
# Add entities
mental add domain <Name> --desc "..." --files "..."
mental add capability <Name> --desc "..." --files "..." --operates-on "Dom1,Dom2"
mental add aspect <Name> --desc "..." --files "..." --applies-to "Cap1,Dom2"
mental add decision "<What>" --why "..."

# Update connections (IMPORTANT!)
mental update capability <Name> --operates-on "Dom1,Dom2,Dom3"
mental update aspect <Name> --applies-to "Cap1,Cap2,Dom1"
mental update domain <Name> --desc "new description"

# View model
mental show          # Text output
mental view          # Interactive visualization in browser

# Delete if needed
mental delete domain <Name>
mental delete capability <Name>
mental delete aspect <Name>
```
