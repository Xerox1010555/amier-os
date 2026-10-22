/**
 * OS-keychain vault via `keytar` when available, with an encrypted-file
 * fallback (AES-256-GCM keyed from machine-local entropy) — key material
 * never crosses IPC and never lands in logs.
 */
import { app } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as crypto from "crypto";

const SERVICE = "jarvis-os";

type KeytarLike = {
  setPassword(service: string, account: string, password: string): Promise<void>;
  getPassword(service: string, account: string): Promise<string | null>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

let keytar: KeytarLike | null = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  keytar = require("keytar") as KeytarLike;
} catch {
  keytar = null; // fallback below
}

const vaultFile = () => path.join(app.getPath("userData"), "jarvis", "vault.bin");

function machineKey(): Buffer {
  const seed = `${process.env.USERNAME ?? process.env.USER ?? "local"}::${require("os").hostname()}::jarvis-v1`;
  return crypto.scryptSync(seed, "jarvis-vault", 32);
}

function fallbackSet(account: string, password: string): void {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", machineKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.mkdirSync(path.dirname(vaultFile()), { recursive: true });
  fs.writeFileSync(vaultFile(), Buffer.concat([iv, tag, ciphertext]));
}

function fallbackGet(account: string): string | null {
  try {
    const raw = fs.readFileSync(vaultFile());
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const ciphertext = raw.subarray(28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", machineKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}

function fallbackDelete(): boolean {
  try {
    fs.rmSync(vaultFile(), { force: true });
    return true;
  } catch {
    return false;
  }
}

export const vault = {
  hasEntry(account: string): boolean {
    if (keytar) {
      void keytar; // async get is awaited via `get`
    }
    return fallbackGet(account) !== null;
  },
  async set(account: string, password: string): Promise<boolean> {
    if (keytar) {
      try {
        await keytar.setPassword(SERVICE, account, password);
        return true;
      } catch {
        /* fall through */
      }
    }
    fallbackSet(account, password);
    return true;
  },
  async get(account: string): Promise<string | null> {
    if (keytar) {
      try {
        const value = await keytar.getPassword(SERVICE, account);
        if (value !== null && value !== undefined) return value;
      } catch {
        /* fall through */
      }
    }
    return fallbackGet(account);
  },
  async delete(account: string): Promise<boolean> {
    if (keytar) {
      try {
        await keytar.deletePassword(SERVICE, account);
      } catch {
        /* still try local delete */
      }
    }
    return fallbackDelete();
  },
};
