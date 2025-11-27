const id = new URL(location.href).searchParams.get("accountId");

if (typeof browser.cloudFile.getAccount(id).configured == "undefined") {
  browser.cloudFile.updateAccount(id, { configured: true });
}
