# Model Router

**Spend less on Claude Code by sending simple work to cheaper models, automatically, without ever going above the model you picked.**

A [Claude Code](https://claude.com/claude-code) mod. Before each model request it looks at what you asked for and picks a tier:

| Tier | Typical prompts | Runs on (default) |
|---|---|---|
| **Light** | "where is…", "explain…", rename, format, typos, small lookups | Haiku |
| **Standard** | routine features, bug fixes, tests | Sonnet |
| **Heavy** | design, architecture, migrations, debugging, security, performance | your session's own model |

Subagents get the same treatment: an `Explore` agent runs on the light model, a `general-purpose` agent is classified from its task.

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
![Claude Code mod](https://img.shields.io/badge/Claude%20Code-mod-d97757)

## Features

- **Never routes up.** A request only moves to a model from a cheaper family than the one it would have used. If you're on Sonnet, standard work isn't touched; heavy work always keeps your model. Unknown models (gateways, non-Claude) are left alone.
- **Respects explicit choices.** A subagent spawned with a named model, or of a type you didn't list, keeps its model.
- **Follow-ups stay put.** "yes", "continue", "do it" keep the previous turn's tier, so a task doesn't bounce between models mid-flow.
- **Escalates long turns.** A routed turn that reaches 12 model requests (configurable) moves up one tier: it was probably harder than it looked.
- **Fails safe.** If a cheaper model gives no answer, the request is retried on your own model and main-loop routing pauses for the session.
- **Free classification.** Keyword rules, no extra model calls. An optional small-model check for ambiguous prompts is off by default.
- **`/route` command** shows what was routed and tokens per model; `/route auto | subagents | off` switches modes for the session.

## Requirements

- **Claude Code 2.1.295 or newer.** This is a *mod*, using Claude Code's function-hooks plugin API, which is in early access and may change between releases.
- A terminal for the one-time install. Once installed, the mod also works in the Claude desktop app's Code tab.

## Installation

### From the Claude Code prompt (recommended)

Start `claude` in a terminal and type:

```
/plugin install model-router --marketplace shezis/claude-model-router
```

1. **Add marketplace?** `github:shezis/claude-model-router`: press **`y`**.
2. Pick the **User** scope (the first option) so it runs in every project.
3. Set the options, or press Enter to keep the defaults.

### From your shell

```bash
claude plugin marketplace add shezis/claude-model-router
```

```bash
claude plugin install model-router@claude-model-router --scope user
```

### Claude desktop app

Slash commands like `/plugin` aren't available in the desktop app's Code tab, so install once from a terminal using either method above, with the **User** scope. After that the mod loads in desktop sessions too.

## Usage

It works on its own once installed. The status line shows the current decision, for example `route: light → claude-haiku-4-5`.

```
/route              what was routed so far, and tokens per model
/route subagents    route subagents only, leave the main conversation alone
/route off          stop routing for this session
/route auto         route both again (also clears a pause after a failure)
```

## Settings

Change these in the install screen, or in `/config` under the plugin's name.

| Setting | Default | What it does |
|---|---|---|
| Routing mode | `auto` | `auto`, `subagents` or `off` |
| Model for light tasks | `haiku` | An alias or a full model id |
| Model for standard tasks | `sonnet` | An alias or a full model id |
| Subagent types to route | `general-purpose,Explore,claude` | Comma-separated agent types |
| Ask a small model when unsure | off | One small-model call per ambiguous prompt |
| Escalate after N requests | `12` | Steps in one turn before moving up a tier |

### Aliases vs full ids

Subagents accept aliases like `haiku`. The **main conversation does not**: it needs a full id such as `claude-sonnet-5-5`. With the default aliases, the router learns the real ids from what Claude Code reports (a subagent's resolved model, the model that answered each response) and only routes the main conversation once it knows one. Until then `/route` counts those requests as "left alone for want of a model id".

To route the main conversation from the first turn, set both model settings to full ids your account can use.

## The trade-off: prompt caching

Claude Code caches your conversation per model. When the main conversation switches models, the first request on the other model has to cache the conversation again, and in long sessions that can eat into the savings. If `/route` shows lots of cache writes, switch to `/route subagents`: subagents start with fresh context, so routing them costs nothing in cache.

## Updating and uninstalling

```bash
claude plugin update model-router@claude-model-router
```

```bash
claude plugin uninstall model-router
```

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Model isn't available" errors | A model setting names something your account can't use. Run `/route off`, then set the light and standard models to full ids you have access to. |
| Main conversation never routes | `/route` will say requests were "left alone for want of a model id". Set full ids in the settings. |
| `/route` isn't recognised | Check it's installed and enabled with `claude plugin list`, then start a new session. |
| A prompt went to the wrong tier | The rules are keyword-based ("fix the typo in the security doc" counts as heavy). They err towards the expensive model, never the cheap one. Turn on the small-model check for better calls. |

## Development

```bash
claude plugin validate .
```

```bash
claude plugin test .
```

The routing hooks live in [`hooks/register.ts`](hooks/register.ts), the keyword rules in [`hooks/classify.ts`](hooks/classify.ts) and the tests in [`tests/router.test.ts`](tests/router.test.ts).

## License

[MIT](LICENSE)

*Not affiliated with Anthropic.*
