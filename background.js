// [cloudFile API — WebExtension API Documentation for Thunderbird 145.0<br><br>Manifest V3 documentation](https://webextension-api.thunderbird.net/en/mv3/cloudFile.html)
class UploadState {
  async set(key, value) {
    let { uploadState } = await browser.storage.local.get({
      uploadState: new Map(),
    });
    uploadState.set(key, value);
    return browser.storage.local.set({ uploadState });
  }
  async get() {
    let { uploadState } = await browser.storage.local.get({
      uploadState: new Map(),
    });
    return uploadState;
  }

  async delete(key) {
    let { uploadState } = await browser.storage.local.get({
      uploadState: new Map(),
    });
    uploadState.delete(key);
    return browser.storage.local.set({ uploadState });
  }
}
var uploads = new UploadState();


browser.composeAction.onClicked.addListener(async (tab) => {
  // Get the existing message.
  let details = await browser.compose.getComposeDetails(tab.id);
  console.log(details);
}); 

browser.cloudFile.onFileUpload.addListener(async (_, { id, name, data }) => {
  let tokenResponse = await fetch(
    "https://api.fex.net/api/v1/anonymous/upload-token",
    {
      method: "GET",
    },
  );
  let tokenData = await tokenResponse.json();
  if (!tokenData.status == 200) {
    throw new Error(
      `Failed to get upload token: error status ${tokenResponse.status}, code ${tokenResponse.status}`,
    );
  }
  const uploadToken = tokenData.token;

  // Initiate file upload to get upload location
  let initResponse = await fetch("https://api.fex.net/api/v1/anonymous/file", {
    method: "POST",
    headers: {
      authorization: `Bearer ${uploadToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      directory_id: null,
      size: data.size,
      name,
    }),
  });
  let initData = await initResponse.json();
  if (!initData.status == 200) {
    throw new Error(
      `Failed to initiate upload: error status ${initResponse.status}, code ${initResponse.code}`,
    );
  }
  const uploadUrl = initData.location;
  const fileKey = initData.anon_upload_link;

  // Create upload resource on storage server
  let createResponse = await fetch(uploadUrl, {
    method: "POST",
    headers: {
      authorization: `Bearer ${uploadToken}`,
      "fsp-filename": encodeURIComponent(name),
      "fsp-size": data.size.toString(),
      "fsp-version": "1.0.0",
    },
  });
  if (!createResponse.status == 200) {
    throw new Error(
      `Failed to create upload resource: error status ${createResponse.status}, code ${createResponse.code}`,
    );
  }

  // Upload file content
  const CHUNK_SIZE = 4 * 1024 * 1024;
  for (let offset = 0; offset < data.size; offset += CHUNK_SIZE) {
    const chunk = data.slice(offset, offset + CHUNK_SIZE);
    let uploadResponse = await fetch(uploadUrl, {
      mode: "cors",
      method: "PATCH",
      headers: {
        authorization: `Bearer ${uploadToken}`,
        "content-type": "application/offset+octet-stream",
        "fsp-offset": offset.toString(),
        "fsp-version": "1.0.0",
      },
      body: chunk,
    });

    if (!uploadResponse.status == 200) {
      throw new Error(
        `Upload failed: ${uploadResponse.status}, code ${uploadResponse.code}`,
      );
    }
  }

  uploads.set(fileKey, { id: id, name: name, token: uploadToken });

  return { url: `https://fex.net/s/${fileKey}` };
});

browser.cloudFile.onFileDeleted.addListener(async (_, id, tab) => {
  console.log("onFileDeleted", id, tab);
});

browser.cloudFile.onFileUploadAbort.addListener(async (_, id, tab) => {
  console.log("onFileUploadAbort", id, tab);
});
