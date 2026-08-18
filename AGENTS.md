<!-- context7 -->
Use Context7 MCP to fetch current documentation whenever the user asks about a library, framework, SDK, API, CLI tool, or cloud service — even well-known ones. This includes API syntax, configuration, version migration, library-specific debugging, setup instructions, and CLI tool usage. Use even when you think you know the answer. Prefer this over web search for library docs.

Do not use for refactoring, writing scripts from scratch, debugging business logic, code review, or general programming concepts.

Start with `resolve-library-id`, then use `query-docs` with the selected `/org/project` identifier and a query scoped to one concept.
<!-- context7 -->

# AGENTS.md

The canonical agent guide for this repository is **[`CLAUDE.md`](CLAUDE.md)**. Read it first for the product contract, safety rules, workflow, and commands.

The work pipeline under `.agents/skills/` is rendered by [the-cycle](https://github.com/brndnsh-labs/the-cycle). Change `.cycle/config.jsonc` or `.cycle/overlays/`, then run `cycle update`; never hand-edit rendered skills.
