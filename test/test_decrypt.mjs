import test from "node:test";
import assert from "node:assert/strict";

const { subtle } = crypto;
const GUARD_STRING = "MDM4MTg5NTQwNzIyNjEyNjc5MzM5MjE0NTMwMjgwNjg=";

function base64Decode(str) {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

async function encryptMovistar(plaintext) {
  const keyBytes = base64Decode(GUARD_STRING);
  const iv = new Uint8Array(12);
  crypto.getRandomValues(iv);
  const ivBase64 = Buffer.from(iv).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  const key = await subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await subtle.encrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, encoded);
  const encBase64 = Buffer.from(encrypted).toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
  return `${encBase64}:${ivBase64}`;
}

async function decryptMovistar(ciphertext) {
  const [encB64, ivB64] = ciphertext.split(":");
  if (!encB64 || !ivB64) {
    throw new Error("Invalid ciphertext format, expected <payload>:<iv>");
  }
  const keyBytes = base64Decode(GUARD_STRING);
  const iv = base64Decode(ivB64);
  const encData = base64Decode(encB64);
  const key = await subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const decrypted = await subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, encData);
  return new TextDecoder().decode(decrypted);
}

function parseMovistarData(rawJson) {
  const data = typeof rawJson === "string" ? JSON.parse(rawJson) : rawJson;
  const planName = data.offering || "Movistar Libre";

  let mainBag = null;
  const extraBags = [];

  if (Array.isArray(data.bolton)) {
    for (const b of data.bolton) {
      if (!mainBag && (b.name === "Navegación" || b.consumptionLabel?.includes("GB") || b.consumptionLabel?.includes("MB"))) {
        mainBag = b;
      } else {
        extraBags.push(b);
      }
    }
  }

  let totalMB = 0;
  let consumedMB = 0;
  let availableMB = 0;
  let percentUsed = 0;
  let cutoffDate = "";
  let daysLeft = 1;

  if (mainBag) {
    cutoffDate = mainBag.vigencia || "";
    percentUsed = typeof mainBag.consumption === "number" ? mainBag.consumption : 0;

    const label = (mainBag.consumptionLabel || "").replace(/Llevas\s+/i, "");
    if (label.includes(" de ")) {
      const [usedPart, totalPart] = label.split(" de ");
      consumedMB = parseSizeToMB(usedPart);
      totalMB = parseSizeToMB(totalPart);
    } else if (mainBag.totalBenefit) {
      totalMB = parseSizeToMB(mainBag.totalBenefit);
      consumedMB = totalMB * (percentUsed / 100);
    }

    availableMB = Math.max(0, totalMB - consumedMB);

    if (cutoffDate) {
      daysLeft = calculateDaysLeft(cutoffDate);
    }
  }

  const dailyMB = daysLeft > 0 ? availableMB / daysLeft : availableMB;
  const rechargeBalance = data.saldos?.totalBalance || "0.00";
  const balanceCutoff = data.saldos?.topupsBalanceExpiration || "";

  return {
    planName,
    totalMB,
    consumedMB,
    availableMB,
    percentUsed,
    cutoffDate,
    daysLeft,
    dailyMB,
    rechargeBalance,
    balanceCutoff,
    extraBags
  };
}

function parseSizeToMB(str) {
  if (!str) return 0;
  const match = str.trim().match(/([\d.,]+)\s*(GB|MB|KB)?/i);
  if (!match) return 0;
  const val = parseFloat(match[1].replace(/,/g, ""));
  const unit = (match[2] || "MB").toUpperCase();
  if (unit === "GB") return val * 1024;
  if (unit === "KB") return val / 1024;
  return val;
}

function calculateDaysLeft(dateStr) {
  const parts = dateStr.trim().split(/[/.-]/);
  if (parts.length < 3) return 1;
  const day = parseInt(parts[0], 10);
  const month = parseInt(parts[1], 10) - 1;
  const year = parseInt(parts[2], 10);
  const target = new Date(year, month, day, 23, 59, 59);
  const now = new Date();
  const diffMs = target.getTime() - now.getTime();
  const diffDays = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  return Math.max(1, diffDays);
}

test("AES-256-GCM encryption and decryption round-trip", async () => {
  const payload = JSON.stringify({
    offering: "Movistar Libre",
    userType: 2,
    bolton: [
      {
        name: "Navegación",
        vigencia: "30/10/2026",
        consumption: 45,
        consumptionLabel: "Llevas 4.50 GB de 10.00 GB",
        totalBenefit: "10.00 GB"
      }
    ],
    saldos: {
      totalBalance: "50.00",
      topupsBalanceExpiration: "30/10/2026"
    }
  });

  const encrypted = await encryptMovistar(payload);
  assert.ok(encrypted.includes(":"), "Should format as <ciphertext>:<iv>");

  const decrypted = await decryptMovistar(encrypted);
  assert.equal(decrypted, payload, "Decrypted payload should match original exactly");
});

function extractPid(input) {
  if (!input) return null;
  const match = input.match(/[?&]p_id=([^&#\s]+)/);
  if (match) return decodeURIComponent(match[1]);
  return input.trim();
}

test("extractPid extracts session token from URL or raw string", () => {
  const url1 = "https://mi.movistar.com.mx/consumptions?p_id=AQIC5wM2LY4Sfcxy_TOKEN_ABC123";
  assert.equal(extractPid(url1), "AQIC5wM2LY4Sfcxy_TOKEN_ABC123");

  const url2 = "https://mi.movistar.com.mx/consumptions?foo=bar&p_id=TOKEN_456&baz=qux";
  assert.equal(extractPid(url2), "TOKEN_456");

  const raw = "TOKEN_789";
  assert.equal(extractPid(raw), "TOKEN_789");
});

test("Parses Movistar consumption JSON correctly", () => {
  const mockPayload = {
    offering: "Movistar Libre 10GB",
    userType: 1,
    bolton: [
      {
        name: "Navegación",
        vigencia: "28/10/2026",
        consumption: 65,
        consumptionLabel: "Llevas 6.50 GB de 10.00 GB",
        totalBenefit: "10.00 GB"
      },
      {
        name: "Redes Sociales",
        consumption: 0,
        consumptionLabel: "Ilimitado",
        totalBenefit: "Ilimitado"
      }
    ],
    saldos: {
      totalBalance: "120.00",
      topupsBalanceExpiration: "28/10/2026"
    }
  };

  const parsed = parseMovistarData(mockPayload);
  assert.equal(parsed.planName, "Movistar Libre 10GB");
  assert.equal(Math.round(parsed.totalMB), 10240);
  assert.equal(Math.round(parsed.consumedMB), 6656);
  assert.equal(Math.round(parsed.availableMB), 3584);
  assert.equal(parsed.percentUsed, 65);
  assert.equal(parsed.rechargeBalance, "120.00");
  assert.equal(parsed.extraBags.length, 1);
  assert.equal(parsed.extraBags[0].name, "Redes Sociales");
});
