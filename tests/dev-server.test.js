"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const http = require("node:http");
const { createServer } = require("../scripts/dev-server");

let server;
let origin;

test.before(async () => {
  server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  origin = `http://127.0.0.1:${server.address().port}`;
});

test.after(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

test("serves the index and application assets with appropriate content types", async () => {
  const index = await fetch(`${origin}/`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get("content-type"), /^text\/html/);
  assert.match(await index.text(), /Retirement Drawdown Modeller/);

  for (const [asset, type] of [["styles.css", "text/css"], ["app.js", "text/javascript"], ["model.js", "text/javascript"]]) {
    const response = await fetch(`${origin}/${asset}`);
    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), new RegExp(`^${type}`));
    assert.ok(Number(response.headers.get("content-length")) > 0);
  }
});

test("supports HEAD without returning a response body", async () => {
  const response = await fetch(`${origin}/styles.css`, { method: "HEAD" });
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /^text\/css/);
  assert.ok(Number(response.headers.get("content-length")) > 0);
  assert.equal(await response.text(), "");
});

test("returns 404 for missing resources", async () => {
  const response = await fetch(`${origin}/missing-resource.js`);
  assert.equal(response.status, 404);
  assert.equal(await response.text(), "Not Found\n");
});

test("returns 405 and an Allow header for unsupported methods", async () => {
  const response = await fetch(`${origin}/`, { method: "POST" });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("allow"), "GET, HEAD");
});

function rawRequest(target) {
  return new Promise((resolve, reject) => {
    const address = server.address();
    const request = http.request({ host: "127.0.0.1", port: address.port, path: target }, response => {
      response.resume();
      response.once("end", () => resolve(response));
    });
    request.once("error", reject);
    request.end();
  });
}

test("rejects traversal, encoded traversal, backslashes, and dot paths", async () => {
  for (const target of ["/../package.json", "/%2e%2e/package.json", "/safe/%2e%2e/package.json", "/.git/config", "/%2eenv", "/safe%5c..%5cpackage.json"]) {
    const response = await rawRequest(target);
    assert.equal(response.statusCode, 400, target);
  }
});
