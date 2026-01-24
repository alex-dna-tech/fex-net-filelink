const id = new URL(location.href).searchParams.get("accountId");
browser.cloudFile.updateAccount(id, { configured: true });

// Remove expired records on script start
removeExpiredRecords();

/**
 * Removes expired records from browser.storage.local
 */
async function removeExpiredRecords() {
  const allData = await browser.storage.local.get(null);
  const keysToRemove = [];

  for (const key in allData) {
    const record = allData[key];

    // Check if it's one of our window state objects with expiration
    if (
      typeof record === "object" &&
      record !== null &&
      record.hasOwnProperty("root_exp") &&
      typeof record.root_exp === "number" &&
      record.root_exp < Date.now()
    ) {
      keysToRemove.push(key);
    }
  }

  if (keysToRemove.length > 0) {
    await browser.storage.local.remove(keysToRemove);
  }
}

/**
 * Formats the remaining time until an expiration timestamp.
 * @param {number} expiryTimestamp - The expiration timestamp in milliseconds.
 * @returns {string} Formatted remaining time (e.g., "6d 5h") or "Expired".
 */
function formatTimeRemaining(expiryTimestamp) {
  // Get the current time
  const now = Date.now();
  // Calculate the remaining time in milliseconds
  const remaining = expiryTimestamp - now;

  // If the time has passed, return "Expired"
  if (remaining <= 0) {
    return "Expired";
  }

  // Calculate remaining days
  const days = Math.floor(remaining / (1000 * 60 * 60 * 24));
  // Calculate remaining hours
  const hours = Math.floor(
    (remaining % (1000 * 60 * 60 * 24)) / (1000 * 60 * 60),
  );

  // If less than an hour remains, show a specific message
  if (days === 0 && hours === 0) {
    return "< 1h";
  }

  // Build the formatted string parts
  const parts = [];
  if (days > 0) {
    parts.push(`${days}d`);
  }
  if (hours > 0) {
    parts.push(`${hours}h`);
  }

  // Join the parts with a space
  return parts.join(" ");
}

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
      // Check if the upload has expired
      const isExpired = windowData.root_exp < Date.now();
      // Format the expiration time for display
      const expirationText = formatTimeRemaining(windowData.root_exp);

      windowData.files.forEach((file) => {
        // Insert a new row in the table
        const row = tableBody.insertRow();
        // If expired, add a CSS class to the row for styling
        if (isExpired) {
          row.classList.add("expired");
        }
        // Insert cells for filename, expiration, and link
        const cellName = row.insertCell();
        const cellExp = row.insertCell();
        const cellLink = row.insertCell();

        // Set filename, with full name in title for hover
        cellName.textContent = file.name;
        cellName.title = file.name;
        // Set the formatted expiration text
        cellExp.textContent = expirationText;
        // Create and append the link to the file
        const link = document.createElement("a");
        link.href = file.url;
        link.textContent = file.fileKey;
        link.target = "_blank";
        cellLink.appendChild(link);
      });
    }
  }

  // Toggle visibility of the uploads table and the "no uploads" message
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
    // Do not remove account configuration
    if (!allData[key].hasOwnProperty("configured")) {
      keysToRemove.push(key);
    }
  }

  if (keysToRemove.length > 0) {
    await browser.storage.local.remove(keysToRemove);
  }
  // Refresh the display
  await displayUploads();
}

document
  .getElementById("clear-uploads-btn")
  .addEventListener("click", clearUploads);
