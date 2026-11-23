# ADR 0022: MCP Server Card and AI Catalog discovery

Status: accepted  
Date: 2026-11-23

## Context

MCP Server Cards ([SEP-2127](https://modelcontextprotocol.io/seps/2127-mcp-server-cards))
describe a remote MCP server: name, version, description, endpoint, and
transport. The [discovery doc](https://github.com/modelcontextprotocol/ext-server-card/blob/main/docs/discovery.md)
reserves `GET <streamable-http-url>/server-card` for the card and
`/.well-known/ai-catalog.json` for a site-level list of cards. Clients that
support discovery can set up a server from its domain alone.

MediaLit, SendLit, and FrontLit all serve MCP through `mcp-server-kit`, and
CourseLit will too, so one implementation covers every product (issue #55).

The card schema has no members for auth, provider, tools, or capabilities.
Capabilities and protocol versions are negotiated through `server/discover`,
and auth through the 401 challenge and protected-resource metadata.

## Decision

- `createMcpServerKit` takes an optional `serverCard` config and exposes
  `serverCard` and `handleServerCard()`. The card is built once at startup.
  An invalid name, version range, over-long description, or non-absolute
  endpoint throws, as does a non-HTTPS endpoint in production.
- Card names use the `dev.codelit/<product>` namespace. Provider identity goes
  in `_meta["dev.codelit/provider"]` (`name`, `url`, and the
  protected-resource metadata URL as a hint). This is the only place the
  schema lets us state it.
- The card lists no tools and no `supportedProtocolVersions`. The SDK has no
  constant for the versions it negotiates, so a list in the card would drift
  from the server.
- The card and catalog are public, static documents served with
  `Access-Control-Allow-Origin: *`, `Cache-Control: public, max-age=3600`, a
  content `ETag`, and `304` on `If-None-Match`. Products route them before
  authentication.
- `createAiCatalogHandler(cards)` serves the catalog. Each entry links to
  `<endpoint>/server-card` with identifier `urn:air:<publisher>:mcp:<name>`.
  The publisher is the reversed namespace, so `dev.codelit/medialit` becomes
  `urn:air:codelit.dev:mcp:medialit`. Cards are linked rather than inlined,
  because clients trust extension data only from a same-origin card.
- `runMcpServerCardConformance` in `platform-conformance` checks the card and
  catalog over the product's real HTTP stack.

## Consequences

- Each product adds `serverCard` to its kit config and routes two GET paths.
  A domain that hosts several MCP servers passes all their cards to one
  catalog handler.
- The server-card extension repo still calls itself experimental. If the
  schema URL or catalog shape changes, the fix is made once, in the kit and
  the conformance suite.
- Tool descriptions stay static code. The card names the operator, so clients
  can tell CodeLit's servers from look-alikes.
