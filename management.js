const accountId = new URL(location.href).searchParams.get("accountId");

browser.cloudFile.updateAccount(accountId, { configured: true });
