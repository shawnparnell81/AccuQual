import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";
import { APP_ORIGIN, isMarketingHost, marketingDocumentTarget, MARKETING_HOME } from "./publicSite.ts";

const webRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

describe("marketing host", () => {
  it("treats www and the apex name as the public site, and the app host as the app", () => {
    assert.equal(isMarketingHost("www.accuqualqms.com"), true);
    assert.equal(isMarketingHost("WWW.ACCUQUALQMS.COM."), true);
    assert.equal(isMarketingHost("accuqualqms.com"), true);
    assert.equal(isMarketingHost("app.accuqualqms.com"), false);
    assert.equal(isMarketingHost("localhost"), false);
  });

  it("sends the marketing home to the landing page and sign-in to the app", () => {
    assert.equal(marketingDocumentTarget("www.accuqualqms.com", "/"), MARKETING_HOME);
    assert.equal(marketingDocumentTarget("accuqualqms.com", "/ncr/4"), MARKETING_HOME);
    assert.equal(marketingDocumentTarget("www.accuqualqms.com", "/login"), `${APP_ORIGIN}/login`);
    assert.equal(
      marketingDocumentTarget("www.accuqualqms.com", "/reset-password", "?token=abc", "#done"),
      `${APP_ORIGIN}/reset-password?token=abc#done`,
    );
    assert.equal(marketingDocumentTarget("www.accuqualqms.com", "/welcome/index.html"), null);
    assert.equal(marketingDocumentTarget("app.accuqualqms.com", "/"), null);
    assert.equal(marketingDocumentTarget("localhost", "/"), null);
  });

  it("the shell redirects marketing hosts before the app bundle, and the landing page signs in on the app", () => {
    const shell = readFileSync(join(webRoot, "index.html"), "utf8");
    assert.match(shell, /www\.accuqualqms\.com/);
    assert.match(shell, /accuqualqms\.com/);
    assert.match(shell, /\/welcome\/index\.html/);
    assert.match(shell, /serviceWorker/);
    assert.match(shell, /app\.accuqualqms\.com/);

    const landing = readFileSync(join(webRoot, "public/welcome/index.html"), "utf8");
    assert.equal(landing.includes("pricing"), false);
    assert.match(landing, /https:\/\/app\.accuqualqms\.com\/login/);
    assert.match(landing, /www\.accuqualqms\.com/);
  });
});
