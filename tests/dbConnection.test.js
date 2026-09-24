import { describe, expect, it } from "vitest";
import { createConnection } from "../electron/db/connection.js";

function openMemory(options = {}) {
  return createConnection({ dbPath: ":memory:", ...options });
}

describe("database connection", () => {
  it("applies the pragmas the project relies on", () => {
    const connection = openMemory();
    expect(connection.db.prepare("PRAGMA foreign_keys").get().foreign_keys).toBe(1);
    expect(String(connection.db.prepare("PRAGMA busy_timeout").get().timeout)).toBe("5000");
    connection.close();
  });

  it("commits work when the transaction body succeeds", () => {
    const connection = openMemory();
    connection.db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    connection.withTransaction(() => {
      connection.db.prepare("INSERT INTO items (name) VALUES (?)").run("first");
    });
    expect(connection.db.prepare("SELECT COUNT(*) AS count FROM items").get().count).toBe(1);
    connection.close();
  });

  it("rolls back everything when the transaction body throws", () => {
    const connection = openMemory();
    connection.db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    expect(() =>
      connection.withTransaction(() => {
        connection.db.prepare("INSERT INTO items (name) VALUES (?)").run("boom");
        throw new Error("failed halfway");
      }),
    ).toThrow("failed halfway");
    expect(connection.db.prepare("SELECT COUNT(*) AS count FROM items").get().count).toBe(0);
    expect(connection.inTransaction()).toBe(false);
    connection.close();
  });

  it("reuses the outer transaction when nested", () => {
    const connection = openMemory();
    connection.db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    connection.withTransaction(() => {
      connection.withTransaction(() => {
        connection.db.prepare("INSERT INTO items (name) VALUES (?)").run("nested");
      });
      expect(connection.inTransaction()).toBe(true);
    });
    expect(connection.db.prepare("SELECT COUNT(*) AS count FROM items").get().count).toBe(1);
    expect(connection.inTransaction()).toBe(false);
    connection.close();
  });

  it("rolls the outer transaction back when a nested body throws", () => {
    const connection = openMemory();
    connection.db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    expect(() =>
      connection.withTransaction(() => {
        connection.db.prepare("INSERT INTO items (name) VALUES (?)").run("outer");
        connection.withTransaction(() => {
          throw new Error("nested failure");
        });
      }),
    ).toThrow("nested failure");
    expect(connection.db.prepare("SELECT COUNT(*) AS count FROM items").get().count).toBe(0);
    connection.close();
  });

  it("refuses async transaction bodies instead of silently committing early", () => {
    const connection = openMemory();
    connection.db.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, name TEXT)");
    expect(() => connection.withTransaction(async () => {})).toThrow(/synchronous/);
    expect(connection.inTransaction()).toBe(false);
    connection.close();
  });

  it("reports table existence and refuses use after close", () => {
    const connection = openMemory();
    connection.db.exec("CREATE TABLE present (id INTEGER PRIMARY KEY)");
    expect(connection.tableExists("present")).toBe(true);
    expect(connection.tableExists("absent")).toBe(false);
    connection.close();
    expect(() => connection.tableExists("present")).toThrow(/closed/);
    expect(() => connection.close()).not.toThrow();
  });
});
