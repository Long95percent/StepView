#!/usr/bin/env node
import crypto from "node:crypto";
import { loadConfig, resolveDataDir } from "../electron/config.js";
import { createAccountStore } from "../electron/gateway/accountStore.js";

/**
 * 直接在服务端建一个账号。
 *
 * 有了它，`STEPVIEW_ALLOW_REGISTRATION` 就可以一直关着——公网部署不该为了加一个人
 * 而临时把注册接口开出去（那是整个应用里唯一一个"不需要凭据就能写数据"的入口）。
 *
 * 用法：
 *   node scripts/create-account.js <用户名> [--password=...] [--name=显示名] [--role=owner]
 * 不给密码就随机生成一个并打印出来（只打印这一次）。
 */

function parseArgs(argv) {
  const options = { username: "", password: "", name: "", role: "" };
  for (const arg of argv) {
    if (!arg.startsWith("--")) {
      if (!options.username) options.username = arg;
      continue;
    }
    const [key, ...rest] = arg.slice(2).split("=");
    const value = rest.join("=");
    if (key === "password") options.password = value;
    else if (key === "name") options.name = value;
    else if (key === "role") options.role = value;
    else throw new Error(`未知参数：--${key}`);
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
if (!options.username) {
  console.error("用法：node scripts/create-account.js <用户名> [--password=...] [--name=显示名]");
  process.exitCode = 1;
} else {
  const config = loadConfig();
  // 和 familyServer 走同一个 resolveDataDir：否则会出现"CLI 建的账号服务端看不见"。
  const dataDir = resolveDataDir({ mode: "family", dataDir: config.dataDir });
  const store = createAccountStore({ dataDir, sessionTtlHours: config.sessionTtlHours });
  const generated = options.password ? "" : crypto.randomBytes(9).toString("base64url");
  try {
    const account = store.registerAccount({
      username: options.username,
      password: options.password || generated,
      displayName: options.name || options.username,
    });
    console.log(`✓ 已建账号 ${account.username}（${account.role}）`);
    console.log(`  数据目录：${dataDir}`);
    if (generated) console.log(`  密码（只显示这一次，请立刻保存）：${generated}`);
  } catch (error) {
    console.error(`✗ 建号失败：${error.message}`);
    process.exitCode = 1;
  } finally {
    store.close();
  }
}
