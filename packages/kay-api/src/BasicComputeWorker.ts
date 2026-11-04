/** Static program sent to Node inside the task container, never run on the host. */
export const basicComputeWorker = String.raw`
import * as fs from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import * as net from "node:net";

const root = "/workspace";
const inputLimit = 256 * 1024;
const outputLimit = 64 * 1024;
const fileReadLimit = 10 * 1024 * 1024;
const send = value => process.stdout.write(JSON.stringify(value) + "\n");
const fail = message => { throw new Error(message); };
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const decode = text => {
  if (typeof text !== "string" || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(text)) fail("Invalid base64 input.");
  const data = Buffer.from(text, "base64");
  if (data.length > inputLimit) fail("Input exceeds 256 KiB.");
  return data;
};
const checkedPath = async (value, createParents = false, allowLeafLink = false) => {
  if (typeof value !== "string" || value.includes("\0")) fail("Invalid workspace path.");
  const absolute = path.resolve(root, value);
  if (absolute !== root && !absolute.startsWith(root + "/")) fail("Path must stay inside /workspace.");
  const parts = path.relative(root, absolute).split("/").filter(Boolean);
  let current = root;
  for (let i = 0; i < parts.length; i++) {
    current = path.join(current, parts[i]);
    let stat;
    try { stat = await fs.lstat(current); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      if (i < parts.length - 1 && createParents) {
        await fs.mkdir(current, { mode: 0o700 });
        stat = await fs.lstat(current);
      } else if (i < parts.length - 1) throw error;
      else continue;
    }
    if (stat.isSymbolicLink() && !(allowLeafLink && i === parts.length - 1)) fail("Symbolic links are not allowed in workspace paths.");
    if (i < parts.length - 1 && !stat.isDirectory()) fail("Workspace parent is not a directory.");
  }
  return absolute;
};
const idle = async pid => {
  if (!Number.isInteger(pid) || pid <= 1) fail("Invalid idle process.");
  const cmd = await fs.readFile("/proc/" + pid + "/cmdline", "utf8");
  if (cmd !== "/usr/bin/sleep\0infinity\0") fail("Idle process changed.");
};
const health = async () => {
  await fs.writeFile(root + "/README.md", [
    "# Task workspace",
    "Use Node.js and npm in /workspace. Python and desktop tools are not installed.",
    "The root filesystem is read-only. Only /workspace (64 MiB) and /tmp (64 MiB) are writable; do not install system packages or move work to /opt or /root. npm uses /tmp/npm-cache. Both filesystems count toward the same 512 MiB total memory limit.",
    "Public HTTP and HTTPS are available through the configured HTTP_PROXY and HTTPS_PROXY. Node fetch uses NODE_USE_ENV_PROXY=1. Private networks, server services and cloud metadata are blocked.",
    "Read public sources and cite their URLs when doing research. Use connected search Apps when available; internet access alone is not a search engine. Never claim a search or source succeeded when it failed.",
    "For PowerPoint, install the established PptxGenJS library with npm install --prefix /workspace --ignore-scripts --no-audit --no-fund pptxgenjs. Then use require('pptxgenjs') in a Node script and await pptx.writeFile({fileName:'/workspace/result.pptx', compression:true}).",
    "Download images with fetch and save them using node:fs/promises. Keep sources and a sources slide. Do not put binary data in command output.",
    "Commands run for up to 120 seconds with 64 KiB of output. The workspace has 512 MiB memory and 64 MiB of files. Internet traffic is limited to 128 MiB per workspace.",
    "Files up to 10 MiB can be downloaded through the computer file browser. Keep the final PPTX under this limit; write its exact path in your reply. File upload through the connector is limited to 256 KiB; download larger assets inside a command.",
    "This workspace is created automatically when a computer tool first needs it. It stays available while the assistant has active work, then is removed after five minutes of confirmed inactivity. Use openbot_computer_export_file to save completed deliverables to the user's Files before your final answer. Keep the temporary source until export succeeds; do not ask the user to rescue files before this workspace expires.",
    "No interactive terminal, browser desktop or incoming ports are available.",
    ""
  ].join("\n"), { flag: "wx", mode: 0o600 });
  const children = (await fs.readFile("/proc/1/task/1/children", "utf8")).trim().split(/\s+/).filter(Boolean).map(Number);
  for (const pid of children) {
    try { await idle(pid); return { idlePid: pid }; } catch {}
  }
  fail("Container idle process is unavailable.");
};
const cleanup = async idlePid => {
  await idle(idlePid);
  let empty = 0;
  for (let attempt = 0; attempt < 100; attempt++) {
    const others = (await fs.readdir("/proc")).filter(name => /^\d+$/.test(name)).map(Number)
      .filter(pid => pid !== 1 && pid !== idlePid && pid !== process.pid);
    if (others.length === 0) {
      if (++empty === 2) { await idle(idlePid); return null; }
    } else {
      empty = 0;
      for (const pid of others) {
        try { process.kill(pid, "SIGKILL"); }
        catch (error) { if (error.code !== "ESRCH") throw error; }
      }
    }
    await pause(20);
  }
  fail("Task processes did not stop; the workspace must be discarded.");
};
const file = async operation => {
  const target = await checkedPath(operation.path ?? operation.file?.path, operation._tag === "Write", operation._tag === "Remove");
  if (operation._tag === "Read") {
    if (!["utf8", "base64"].includes(operation.encoding)) fail("Invalid file encoding.");
    const handle = await fs.open(target, constants.O_RDONLY | constants.O_NOFOLLOW);
    try {
      const stat = await handle.stat();
      if (!stat.isFile()) fail("Choose a regular file.");
      if (stat.size > fileReadLimit) fail("File exceeds the 10 MiB download limit.");
      const data = await handle.readFile();
      if (data.length > fileReadLimit) fail("File exceeds the 10 MiB download limit.");
      const result = { path: operation.path, encoding: operation.encoding, content: data.toString(operation.encoding) };
      if (Buffer.byteLength(JSON.stringify(result)) > 15 * 1024 * 1024) fail("Use base64 to download this file.");
      return result;
    } finally { await handle.close(); }
  }
  if (operation._tag === "Write") {
    if (!["utf8", "base64"].includes(operation.file.encoding)) fail("Invalid file encoding.");
    const data = operation.file.encoding === "base64" ? decode(operation.file.content) : Buffer.from(operation.file.content, "utf8");
    if (data.length > inputLimit) fail("File exceeds the 256 KiB write limit.");
    const handle = await fs.open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | constants.O_NOFOLLOW, 0o600);
    try { if (!(await handle.stat()).isFile()) fail("Choose a regular file."); await handle.writeFile(data); }
    finally { await handle.close(); }
    return null;
  }
  if (operation._tag === "List") {
    const names = await fs.readdir(target);
    if (names.length > 512) fail("Folder exceeds the 512 entry listing limit.");
    const entries = [];
    for (const name of names.sort()) {
      const stat = await fs.lstat(path.join(target, name));
      entries.push({ name, kind: stat.isSymbolicLink() ? "link" : stat.isDirectory() ? "directory" : "file", size: stat.size, modifiedAt: Math.trunc(stat.mtimeMs) });
    }
    if (Buffer.byteLength(JSON.stringify(entries)) > outputLimit) fail("Folder listing exceeds 64 KiB.");
    return entries;
  }
  if (operation._tag === "Remove") {
    if (target === root) fail("The workspace root cannot be removed.");
    await fs.rm(target, { recursive: true, force: false });
    return null;
  }
  fail("Unsupported file operation.");
};

const lines = createInterface({ input: process.stdin, crlfDelay: Infinity });
let started = false;
let child;
let inputBytes = 0;
let terminal = false;
const finish = value => {
  if (terminal) return;
  terminal = true;
  lines.close();
  process.stdin.destroy();
  process.stdout.write(JSON.stringify(value) + "\n", () => process.exit(0));
};
lines.on("line", async line => {
  if (terminal) return;
  try {
    if (Buffer.byteLength(line) > inputLimit * 6) fail("Request is too large.");
    const request = JSON.parse(line);
    if (started) {
      if (!child) fail("No command is running.");
      if (request.type === "input") {
        const data = decode(request.data);
        inputBytes += data.length;
        if (inputBytes > inputLimit) fail("Command input exceeds 256 KiB.");
        if (data.length === 1 && data[0] === 4) child.stdin.end();
        else child.stdin.write(data);
      } else if (request.type === "signal" && ["SIGINT", "SIGTERM", "SIGKILL", "SIGHUP", "SIGQUIT"].includes(request.signal)) {
        try { process.kill(-child.pid, request.signal); } catch (error) { if (error.code !== "ESRCH") throw error; }
      } else fail("Unsupported command control.");
      return;
    }
    started = true;
    if (request.mode === "health") return finish({ event: "result", value: await health() });
    if (request.mode === "cleanup") return finish({ event: "result", value: await cleanup(request.idlePid) });
    if (request.mode === "file") return finish({ event: "result", value: await file(request.operation) });
    if (request.mode !== "command") fail("Unsupported worker operation.");
    if (typeof request.command !== "string" || request.command.includes("\0") || Buffer.byteLength(request.command) > inputLimit) fail("Invalid command.");
    const cwd = await checkedPath(request.cwd ?? root);
    const env = { PATH: "/usr/local/bin:/usr/bin:/bin", HOME: root, TMPDIR: "/tmp", LANG: "C.UTF-8", NPM_CONFIG_CACHE: "/tmp/npm-cache", NPM_CONFIG_MAXSOCKETS: "4" };
    // Only loopback exists in this container. The broker checks every external destination.
    const bridge = net.createServer(socket => {
      const upstream = net.connect("/run/kay-internet.sock");
      socket.on("error", () => upstream.destroy());
      upstream.on("error", () => socket.destroy());
      socket.on("close", () => upstream.destroy());
      upstream.on("close", () => socket.destroy());
      socket.pipe(upstream).pipe(socket);
    });
    await new Promise((resolve, reject) => {
      bridge.once("error", reject);
      bridge.listen(0, "127.0.0.1", resolve);
    });
    const proxy = "http://127.0.0.1:" + bridge.address().port;
    Object.assign(env, { HTTP_PROXY: proxy, HTTPS_PROXY: proxy, http_proxy: proxy, https_proxy: proxy, NODE_USE_ENV_PROXY: "1" });
    for (const [key, value] of Object.entries(request.env ?? {})) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || typeof value !== "string" || value.includes("\0")) fail("Invalid command environment.");
      env[key] = value;
    }
    child = spawn("/bin/bash", ["-lc", request.command], { cwd, env, detached: true, stdio: ["pipe", "pipe", "pipe"] });
    child.stdin.on("error", () => {});
    send({ event: "ready" });
    let bytes = 0;
    const output = data => {
      const remaining = outputLimit - bytes;
      if (remaining > 0) send({ event: "output", data: data.subarray(0, remaining).toString("base64") });
      bytes += data.length;
      if (bytes > outputLimit) finish({ event: "limit", reason: "output_limit" });
    };
    child.stdout.on("data", output);
    child.stderr.on("data", output);
    child.on("error", () => finish({ event: "error", code: "Failed", message: "The command could not start." }));
    child.on("close", (code, signal) => finish({ event: "exit", code, signal }));
    setTimeout(() => finish({ event: "limit", reason: "time_limit" }), 120000).unref();
  } catch (error) {
    finish({ event: "error", code: error.code === "ENOENT" ? "NotFound" : "Failed", message: error.message });
  }
});
`
