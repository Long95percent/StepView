import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dockerfile = readFileSync(new URL("../Dockerfile", import.meta.url), "utf8");
const dockerignore = readFileSync(new URL("../.dockerignore", import.meta.url), "utf8");
const compose = readFileSync(new URL("../compose.yaml", import.meta.url), "utf8");

/** Dockerfile 里从 `FROM ... AS name` 到下一个 FROM 之间的内容。 */
function stage(name) {
  const start = dockerfile.indexOf(` AS ${name}\n`);
  if (start < 0) throw new Error(`Dockerfile 里没有 ${name} 阶段`);
  const rest = dockerfile.slice(start);
  const next = rest.indexOf("\nFROM ");
  return next < 0 ? rest : rest.slice(0, next);
}

/** compose.yaml 里某个顶层 service 的正文。 */
function serviceBlock(name) {
  const lines = compose.split("\n");
  const start = lines.findIndex((line) => line === `  ${name}:`);
  if (start < 0) throw new Error(`compose.yaml 里没有 ${name} 服务`);
  const body = [];
  for (const line of lines.slice(start + 1)) {
    if (/^ {2}\S/.test(line)) break;
    body.push(line);
  }
  return body.join("\n");
}

// 这些断言防的是"部署改造被后来的人顺手改回去"：每一条都对应一个已经踩过的坑，
// 不是风格检查。

describe("容器镜像", () => {
  it("基础镜像按摘要固定，不用会漂的 tag", () => {
    const stages = new Set();
    const froms = dockerfile.split("\n").filter((line) => line.startsWith("FROM "));
    expect(froms.length).toBeGreaterThan(0);
    for (const line of froms) {
      const [source, , stageName] = line.slice(5).split(" ");
      // 引用前面阶段（FROM dependencies AS ...）不需要摘要，那本身就是本仓库的口径。
      if (!stages.has(source)) expect(line).toMatch(/^FROM \S+@sha256:[0-9a-f]{64}( AS \S+)?$/);
      if (stageName) stages.add(stageName);
    }
  });

  it("网关以 node 用户运行，而不是 root", () => {
    const gateway = stage("gateway");
    expect(gateway).toMatch(/^USER node$/m);
    expect(gateway).not.toMatch(/^USER root$/m);
  });

  it("web 以 nginx 用户运行，并且监听非特权端口", () => {
    const web = stage("web");
    expect(web).toMatch(/^USER nginx$/m);
    expect(web).toMatch(/^EXPOSE 8080$/m);
  });

  it("数据目录永远不进构建上下文", () => {
    for (const entry of [".stepview-family-data", ".stepview-personal-data", ".stepview-runtime"]) {
      expect(dockerignore.split("\n")).toContain(entry);
    }
  });
});

describe("compose 拓扑", () => {
  it("网关只在容器内网可达，不发布宿主机端口", () => {
    const gateway = serviceBlock("gateway");
    expect(gateway).toMatch(/^ {4}expose:$/m);
    expect(gateway).not.toMatch(/^ {4}ports:$/m);
  });

  it("web 仍然只暴露一个宿主机端口，指向非 root 的 8080", () => {
    const web = serviceBlock("web");
    expect(web).toContain(":5173:8080");
    expect(web).not.toContain(":5173:80\"");
  });

  it("注册默认关闭", () => {
    expect(serviceBlock("gateway")).toContain("STEPVIEW_ALLOW_REGISTRATION: ${STEPVIEW_ALLOW_REGISTRATION:-false}");
  });

  it("redis 也按摘要固定", () => {
    expect(serviceBlock("redis")).toMatch(/^ {4}image: redis:[^ \n]+@sha256:[0-9a-f]{64}$/m);
  });
});
