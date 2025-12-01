function parseJwt(token) {
  var base64Url = token.split(".")[1];
  var base64 = base64Url.replace(/-/g, "+").replace(/_/g, "/");
  var jsonPayload = decodeURIComponent(
    window
      .atob(base64)
      .split("")
      .map(function (c) {
        return "%" + ("00" + c.charCodeAt(0).toString(16)).slice(-2);
      })
      .join(""),
  );

  return JSON.parse(jsonPayload);
}

// [cloudFile API — WebExtension API Documentation for Thunderbird 145.0<br><br>Manifest V3 documentation](https://webextension-api.thunderbird.net/en/mv3/cloudFile.html)

browser.cloudFile.onFileUpload.addListener(
  async (account, fileInfo, tab, relatedFileInfo) => {
    console.log(
      "onFileUpload params",
      account,
      fileInfo.id,
      fileInfo.name,
      tab,
      relatedFileInfo,
    );
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
    let initResponse = await fetch(
      "https://api.fex.net/api/v1/anonymous/file",
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${uploadToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          directory_id: null,
          size: fileInfo.data.size,
          name: fileInfo.name,
        }),
      },
    );
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
        "fsp-filename": encodeURIComponent(fileInfo.name),
        "fsp-size": fileInfo.data.size.toString(),
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
    for (let offset = 0; offset < fileInfo.data.size; offset += CHUNK_SIZE) {
      const chunk = fileInfo.data.slice(offset, offset + CHUNK_SIZE);
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

    return { url: `https://fex.net/s/${fileKey}` };
  },
);

browser.cloudFile.onAccountAdded.addListener((account) => {
  console.log("onAccountAdded", account);
});

browser.cloudFile.onAccountDeleted.addListener((account) => {
  console.log("onAccountDeleted", account);
});

browser.cloudFile.onFileDeleted.addListener((account, fileId, tab) => {
  console.log("onFileDeleted", account, fileId, tab);
});

browser.cloudFile.onFileRename.addListener((account, fileId, newName, tab) => {
  console.log("onFileRename", account, fileId, newName, tab);
});

browser.cloudFile.onFileUploadAbort.addListener((account, fileId, tab) => {
  console.log("onFileUploadAbort ", account, fileId, tab);
});
