"use strict";
const tls = require("node:tls");
const https = require("node:https");
const { X509Certificate } = require("node:crypto");

// Mozilla incident 2083449: remove both trust paths for the compromised
// eMudhra intermediates while the managed Node runtime awaits a root update.
const BLOCKED_ROOTS = new Set([
  "86A1ECBA089C4A8D3BBE2734C612BA341D813E043CF9E8A862CD5C57A36BBE6B",
  "D7A7A0FB5D7E2731D771E9484EBCDEF71D5F0C3E0A2948782BC83EE0EA699EF4",
]);
function safeRoots(roots = tls.rootCertificates) {
  const result = roots.filter((pem) => !BLOCKED_ROOTS.has(
    new X509Certificate(pem).fingerprint256.replace(/:/g, ""),
  ));
  if (!result.length) throw new Error("No trusted TLS roots available");
  return result;
}
const ca = safeRoots();
const agent = new https.Agent({ ca, rejectUnauthorized: true, keepAlive: true });
function installSdkTrust() {
  if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
    throw new Error("TLS verification must remain enabled");
  // wx-server-sdk 4.0.2 / CloudBase 3.17.2 use the default agent when
  // keepalive:false and no proxy are supplied. Install before loading the SDK.
  https.globalAgent.options.ca = ca;
  https.globalAgent.options.rejectUnauthorized = true;
}
module.exports = { safeRoots, ca, agent, installSdkTrust };
