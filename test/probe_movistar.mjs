#!/usr/bin/env node

/**
 * Movistar API Probe CLI (Node.js)
 * Tests credentials, session token validation, and consumption payload decryption.
 *
 * Usage:
 *   node test/probe_movistar.mjs --mock
 *   MOVISTAR_TOKEN="<p_id>" node test/probe_movistar.mjs
 */

const { subtle } = crypto;
const GUARD_STRING = "MDM4MTg5NTQwNzIyNjEyNjc5MzM5MjE0NTMwMjgwNjg=";

function base64Decode(str) {
  const padding = "=".repeat((4 - (str.length % 4)) % 4);
  const b64 = (str + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Buffer.from(b64, "base64");
}

async function decryptMovistar(ciphertext) {
  const [encB64, ivB64] = ciphertext.split(":");
  if (!encB64 || !ivB64) {
    throw new Error("Invalid encrypted format, expected <payload>:<iv>");
  }
  const keyBytes = base64Decode(GUARD_STRING);
  const iv = base64Decode(ivB64);
  const encData = base64Decode(encB64);
  const key = await subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]);
  const decrypted = await subtle.decrypt({ name: "AES-GCM", iv, tagLength: 128 }, key, encData);
  return new TextDecoder().decode(decrypted);
}

async function fetchConsumption(token) {
  const url = "https://mi.movistar.com.mx/consumptions-controller/datos-iniciales";
  const res = await fetch(url, {
    method: "GET",
    headers: {
      "Authorization": token,
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148"
    }
  });

  if (!res.ok) {
    throw new Error(`HTTP error ${res.status}: ${res.statusText}`);
  }

  const json = await res.json();
  if (!json || !json.content) {
    throw new Error(`Unexpected response structure: ${JSON.stringify(json)}`);
  }

  const decryptedText = await decryptMovistar(json.content);
  return JSON.parse(decryptedText);
}

function printMockReport() {
  const sample = {
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
      },
      {
        name: "Minutos y SMS",
        consumptionLabel: "Ilimitado",
        totalBenefit: "Ilimitado"
      }
    ],
    saldos: {
      totalBalance: "150.00",
      giftBalance: "0.00",
      topupsBalanceExpiration: "28/10/2026"
    }
  };

  console.log("\n=============================================");
  console.log("       MOVISTAR MÉXICO PROBE REPORT (MOCK)    ");
  console.log("=============================================");
  console.log(`Plan Offering:       ${sample.offering}`);
  console.log(`Primary Data Bag:    ${sample.bolton[0].consumptionLabel}`);
  console.log(`Usage Percentage:    ${sample.bolton[0].consumption}%`);
  console.log(`Cutoff Date:         ${sample.bolton[0].vigencia}`);
  console.log(`Recharge Balance:    $${sample.saldos.totalBalance}`);
  console.log(`Social / Unlimited:  ${sample.bolton[1].name} (${sample.bolton[1].consumptionLabel})`);
  console.log("=============================================\n");
}

async function main() {
  const isMock = process.argv.includes("--mock");
  const token = process.env.MOVISTAR_TOKEN;

  if (isMock || !token) {
    if (!isMock) {
      console.log("No MOVISTAR_TOKEN environment variable provided. Displaying mock probe demonstration.\nTo test live, run with MOVISTAR_TOKEN=<p_id> node test/probe_movistar.mjs");
    }
    printMockReport();
    return;
  }

  try {
    console.log("Fetching live consumption from mi.movistar.com.mx...");
    const data = await fetchConsumption(token);
    console.log("Decrypted API Response:");
    console.log(JSON.stringify(data, null, 2));
  } catch (err) {
    console.error("Probe error:", err.message);
    process.exitCode = 1;
  }
}

main();
