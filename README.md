# TabProxy

A lightweight web proxy with a tabbed browser interface. No dependencies.

## Run
1. Install Node.js 18 or newer (https://nodejs.org)
2. In this folder run:  `node server.js`
3. Open http://localhost:8080

Change the port with `PORT=3000 node server.js`.

## Notes
- Works well for most static and moderately dynamic sites.
- Complex web apps (Google login, YouTube, Discord, etc.) may break; this is a
  simple rewriting proxy, not a full browser-in-the-cloud.
- Cookies are kept in memory on the server and shared by everyone using it, so
  run it for yourself only and don't expose it publicly.
