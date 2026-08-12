"use strict";

const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const publicRoot = path.resolve(__dirname, "..");
const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8"
};

function sendText(response, statusCode, message, headers = {}) {
  const body = Buffer.from(`${message}\n`);
  response.writeHead(statusCode, {
    "Content-Type": "text/plain; charset=utf-8",
    "Content-Length": body.length,
    ...headers
  });
  response.end(body);
}

function safeFilePath(requestTarget) {
  const rawPath = requestTarget.split(/[?#]/, 1)[0];
  let decodedPath;
  try {
    decodedPath = decodeURIComponent(rawPath);
  } catch {
    return null;
  }
  if (!decodedPath.startsWith("/") || decodedPath.includes("\\") || decodedPath.includes("\0")) return null;
  const segments = decodedPath.split("/").filter(Boolean);
  if (segments.some(segment => segment.startsWith("."))) return null;
  const relativePath = segments.length === 0 ? "index.html" : segments.join("/");
  const filePath = path.resolve(publicRoot, relativePath);
  return filePath.startsWith(`${publicRoot}${path.sep}`) ? filePath : null;
}

function createServer() {
  return http.createServer((request, response) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      sendText(response, 405, "Method Not Allowed", { Allow: "GET, HEAD" });
      return;
    }

    const filePath = safeFilePath(request.url || "/");
    if (!filePath) {
      sendText(response, 400, "Bad Request");
      return;
    }

    fs.stat(filePath, (statError, stats) => {
      if (statError || !stats.isFile()) {
        sendText(response, 404, "Not Found");
        return;
      }
      const contentType = contentTypes[path.extname(filePath).toLowerCase()] || "application/octet-stream";
      response.writeHead(200, {
        "Content-Type": contentType,
        "Content-Length": stats.size,
        "Cache-Control": "no-store"
      });
      if (request.method === "HEAD") {
        response.end();
        return;
      }
      const stream = fs.createReadStream(filePath);
      stream.on("error", () => {
        if (!response.headersSent) sendText(response, 500, "Internal Server Error");
        else response.destroy();
      });
      stream.pipe(response);
    });
  });
}

if (require.main === module) {
  const port = Number(process.env.PORT || 5173);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    process.stderr.write("PORT must be an integer from 1 to 65535.\n");
    process.exitCode = 1;
  } else {
    createServer().listen(port, "127.0.0.1", () => {
      process.stdout.write(`Retirement modeller available at http://127.0.0.1:${port}\n`);
    });
  }
}

module.exports = { createServer, safeFilePath };
