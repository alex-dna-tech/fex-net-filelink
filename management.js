const id = new URL(location.href).searchParams.get("accountId");
browser.cloudFile.updateAccount(id, { configured: true });

async function displayUploads() {
  const tableBody = document.querySelector("#uploads-table tbody");
  tableBody.innerHTML = ""; // Clear existing rows

  const allData = await browser.storage.local.get(null);
  let filesFound = false;

  for (const key in allData) {
    // A simple check to see if it's one of our window state objects
    if (
      typeof allData[key] === "object" &&
      allData[key] !== null &&
      allData[key].hasOwnProperty("files") &&
      Array.isArray(allData[key].files) &&
      allData[key].files.length > 0
    ) {
      filesFound = true;
      const windowData = allData[key];
      const expirationDate = new Date(windowData.root_exp).toLocaleString();

      windowData.files.forEach((file) => {
        const row = tableBody.insertRow();
        const cellName = row.insertCell();
        const cellExp = row.insertCell();
        const cellLink = row.insertCell();

        cellName.textContent = file.name;
        cellExp.textContent = expirationDate;
        const link = document.createElement("a");
        link.href = file.url;
        link.textContent = file.fileKey;
        link.target = "_blank";
        cellLink.appendChild(link);
      });
    }
  }

  if (filesFound) {
    document.getElementById("uploads-view").style.display = "block";
    document.getElementById("no-uploads-view").style.display = "none";
  } else {
    document.getElementById("uploads-view").style.display = "none";
    document.getElementById("no-uploads-view").style.display = "block";
  }
}

displayUploads();

async function clearUploads() {
  const allData = await browser.storage.local.get(null);
  const keysToRemove = [];
  for (const key in allData) {
    if (!allData[key].hasOwnProperty("configured")) {
      keysToRemove.push(key);
    }
  }

  if (keysToRemove.length > 0) {
    await browser.storage.local.remove(keysToRemove);
  }
  await displayUploads();
}

document
  .getElementById("clear-uploads-btn")
  .addEventListener("click", clearUploads);
