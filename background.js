browser.cloudFile.onFileUpload.addListener(
  async (account, { id, name, data }) => {
    let tokenResponse = await fetch(
      "https://api.fex.net/api/v1/anonymous/upload-token",
      {
        method: "GET",
      },
    );
    if (!tokenResponse.ok) {
      throw new Error(
        `Failed to get upload token: ${tokenResponse.statusText}`,
      );
    }
    let tokenData = await tokenResponse.json();
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
          size: data.size,
          name,
        }),
      },
    );
    if (!initResponse.ok) {
      throw new Error(`Failed to initiate upload: ${initResponse.statusText}`);
    }
    let initData = await initResponse.json();
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
    if (!createResponse.ok) {
      throw new Error(
        `Failed to create upload resource: ${createResponse.statusText}`,
      );
    }

    // Upload file content
    const CHUNK_SIZE = 4 * 1024 * 1024;
    for (let offset = 0; offset < data.size; offset += CHUNK_SIZE) {
      const chunk = data.slice(offset, offset + CHUNK_SIZE);
      let uploadResponse = await fetch(uploadUrl, {
        method: "PATCH",
        headers: {
          authorization: `Bearer ${uploadToken}`,
          "content-type": "application/offset+octet-stream",
          "fsp-offset": offset.toString(),
          "fsp-version": "1.0.0",
        },
        body: chunk,
      });

      if (!uploadResponse.ok) {
        throw new Error(`Upload failed: ${uploadResponse.statusText}`);
      }
    }

    return { url: `https://fex.net/s/${fileKey}` };
  },
);
